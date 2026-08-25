import { Routes } from '@/config/routes';
import { AUTH_TOKEN_KEY } from '@/lib/constants';
import type { SearchParamOptions } from '@/types';
import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import Router from 'next/router';

// ── Política de errores de la frontera HTTP ─────────────────────────────
// Cada intento espera como mucho esto. Sin timeout, una API colgada
// bloquea el render de SSR indefinidamente.
const REQUEST_TIMEOUT_MS = 15_000;
// Fallos transitorios: hasta 3 intentos con backoff exponencial (400ms, 800ms).
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;
// Códigos de red que suelen significar "vuelve a intentarlo en un momento".
const RETRIABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNABORTED', // código propio de axios cuando se agota `timeout`
  'ERR_NETWORK', // fallo de red genérico de axios v1 (lado navegador)
]);
// Solo se reintentan métodos idempotentes: repetir un POST podría crear
// pedidos/reseñas duplicados.
const RETRIABLE_METHODS = new Set(['get', 'head', 'options']);

type RetryableConfig = InternalAxiosRequestConfig & { __attempt?: number };

/**
 * Error HTTP plano y serializable con JSON.
 *
 * Un AxiosError arrastra `request` → `socket` → `agent` → ... → `request`:
 * una estructura circular. Next renderiza el SSR en un worker y reporta los
 * errores al proceso padre con `JSON.stringify`; un error circular mata al
 * worker con "Converting circular structure to JSON" y entierra el fallo
 * real (p. ej. un simple ECONNREFUSED). Este error solo contiene strings,
 * números y datos ya-JSON, así que siempre cruza esa frontera.
 *
 * `isAxiosError` y `response` se mantienen (en versión plana) para que el
 * código existente que hace `axios.isAxiosError(err)` o lee
 * `err.response?.data?.message` / `err.response?.status` siga funcionando.
 */
export class HttpError extends Error {
  name = 'HttpError';
  isAxiosError = true;
  method?: string;
  url?: string;
  code?: string;
  status?: number;
  attempts?: number;
  response?: { status: number; data: unknown };

  constructor(
    message: string,
    fields: {
      method?: string;
      url?: string;
      code?: string;
      status?: number;
      attempts?: number;
      response?: { status: number; data: unknown };
    } = {},
  ) {
    super(message);
    Object.assign(this, fields);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      method: this.method,
      url: this.url,
      code: this.code,
      status: this.status,
      attempts: this.attempts,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestUrl(config?: RetryableConfig) {
  if (!config) return '(unknown url)';
  return `${config.baseURL ?? ''}${config.url ?? ''}`;
}

// Lee `message` de un cuerpo de error de tipo desconocido sin recurrir a
// `as any`: el cuerpo viene de la red y no hay garantía de su forma.
function mensajeDe(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('message' in data)) {
    return undefined;
  }
  const message = (data as { message: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

// Deja `response.data` sin referencias vivas (streams, sockets…).
function toPlainData(data: unknown) {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return String(data);
  }
}

function isTransient(error: AxiosError) {
  if (error.response) return error.response.status >= 500;
  return error.code ? RETRIABLE_CODES.has(error.code) : false;
}

/** Normaliza cualquier error de Axios a un HttpError plano e informativo. */
function toHttpError(error: AxiosError): HttpError {
  const config = error.config as RetryableConfig | undefined;
  const method = (config?.method ?? 'get').toUpperCase();
  const url = requestUrl(config);
  const attempts = config?.__attempt ?? 1;
  const attemptsNote = attempts > 1 ? ` after ${attempts} attempts` : '';

  if (error.response) {
    const { status, statusText } = error.response;
    return new HttpError(
      `${method} ${url} failed${attemptsNote}: HTTP ${status}${
        statusText ? ` ${statusText}` : ''
      }`,
      {
        method,
        url,
        status,
        code: error.code,
        attempts,
        response: { status, data: toPlainData(error.response.data) },
      },
    );
  }

  const code = error.code ?? 'NETWORK_ERROR';
  let hint = '';
  if (code === 'ECONNREFUSED') {
    hint = ' — nothing is listening on that address. Is the API running?';
  } else if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    hint = ` — no response within ${
      config?.timeout ?? REQUEST_TIMEOUT_MS
    }ms. The API is up but not answering, or hung.`;
  } else if (code === 'EAI_AGAIN') {
    hint = ' — DNS lookup failed (temporary). Check network/DNS.';
  }
  return new HttpError(`${method} ${url} failed${attemptsNote}: ${code}${hint}`, {
    method,
    url,
    code,
    attempts,
  });
}

const Axios = axios.create({
  baseURL: process.env.NEXT_PUBLIC_REST_API_ENDPOINT,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});
// Change request data/error here
Axios.interceptors.request.use((config) => {
  const token = Cookies.get(AUTH_TOKEN_KEY);
  //@ts-ignore
  config.headers = {
    ...config.headers,
    Authorization: `Bearer ${token ? token : ''}`,
  };
  return config;
});

// Change response data/error here
Axios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;

    // Reintento con backoff de fallos transitorios (red caída / 5xx),
    // solo en peticiones idempotentes.
    if (
      config &&
      isTransient(error) &&
      RETRIABLE_METHODS.has((config.method ?? 'get').toLowerCase())
    ) {
      const attempt = config.__attempt ?? 1;
      if (attempt < MAX_ATTEMPTS) {
        config.__attempt = attempt + 1;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        return Axios(config);
      }
    }

    // Limpieza de sesión: solo en el navegador (Router no existe en SSR).
    if (
      typeof window !== 'undefined' &&
      (error.response?.status === 401 ||
        error.response?.status === 403 ||
        mensajeDe(error.response?.data) === 'PICKBAZAR_ERROR.NOT_AUTHORIZED')
    ) {
      Cookies.remove(AUTH_TOKEN_KEY);
      Router.replace(Routes.home);
    }

    return Promise.reject(toHttpError(error));
  },
);

export class HttpClient {
  static async get<T>(url: string, params?: unknown) {
    const response = await Axios.get<T>(url, { params });
    return response.data;
  }

  static async post<T>(url: string, data: unknown, options?: any) {
    const response = await Axios.post<T>(url, data, options);
    return response.data;
  }

  static async put<T>(url: string, data: unknown) {
    const response = await Axios.put<T>(url, data);
    return response.data;
  }

  static async delete<T>(url: string) {
    const response = await Axios.delete<T>(url);
    return response.data;
  }

  static formatSearchParams(params: Partial<SearchParamOptions>) {
    return Object.entries(params)
      .filter(([, value]) => Boolean(value))
      .map(([k, v]) =>
        ['type', 'categories', 'tags', 'author', 'manufacturer','shops'].includes(k)
          ? `${k}.slug:${v}`
          : `${k}:${v}`
      )
      .join(';');
  }
}
