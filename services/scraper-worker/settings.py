import os
from dotenv import load_dotenv

load_dotenv()

BOT_NAME = "scraper_worker"
SPIDER_MODULES = ["spiders"]
NEWSPIDER_MODULE = "spiders"

# --- CONFIGURACIÓN DE PLAYWRIGHT ---
DOWNLOAD_HANDLERS = {
    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}

TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

PLAYWRIGHT_LAUNCH_OPTIONS = {
    "headless": True, 
    "args": ["--disable-blink-features=AutomationControlled"],
}

# Esto es genial, ahorra mucho ancho de banda
def should_abort_request(request):
    return request.resource_type in ["image", "font", "media"]

PLAYWRIGHT_ABORT_REQUEST = should_abort_request
PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT = 120000 

# --- CONFIGURACIÓN DE POSTGRES ---
import os
import logging
from dotenv import load_dotenv

load_dotenv()

# La cadena de conexión se toma del entorno para no versionar credenciales.
# Copia .env.example a .env, o levanta la base local con `just db-up`.
# Formato: postgresql://usuario:clave@host:puerto/basededatos
DATABASE_URL = os.environ.get('DATABASE_URL')

# Reduce noisy debug logs from third-party libraries to keep console responsive
LOG_LEVEL = 'INFO'  # Cambia a 'DEBUG' para más detalles, pero ten cuidado con el rendimiento
# suppress very verbose logs
logging.getLogger('scrapy_playwright').setLevel(logging.WARNING)
logging.getLogger('playwright').setLevel(logging.WARNING)

ITEM_PIPELINES = {
    'pipelines.PostgresPipeline': 300,
}

# --- OTROS AJUSTES ---
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
ROBOTSTXT_OBEY = False
CONCURRENT_REQUESTS_PER_DOMAIN = 2
DOWNLOAD_DELAY = 2 
FEED_EXPORT_ENCODING = 'utf-8'