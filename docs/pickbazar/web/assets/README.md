# Imágenes de Pickbazar y Borobazar (copia local de S3)

Copia local de las imágenes que el repo referencia en buckets S3 de
terceros, por si esos buckets dejan de estar disponibles. Se descargaron
el 2026-10-24.

## Zips

Las imágenes se guardan en tres zips, porque GitHub no admite archivos
de más de 100 MB y un solo zip pesaría unos 120:

| Zip | Contenido | Archivos | Tamaño |
|---|---|---|---|
| `pickbazar-1-577.zip` | `pickbazar/1` … `pickbazar/577` | 1108 | 56,5 MB |
| `pickbazar-578-2471.zip` | `pickbazar/578` … `pickbazar/2471` | 1846 | 59,4 MB |
| `borobazar.zip` | `borobazar/` | 144 | 4,6 MB |

Para extraerlos aquí mismo (desde esta carpeta):

```bash
for z in *.zip; do tar -xf "$z"; done
```

En Windows usa el `tar` del sistema (`C:\Windows\System32\tar.exe`) o
el explorador. Los nombres van en UTF-8: cuatro llevan `é`
(`Capture-d'écran-…`). Las carpetas extraídas están en `.gitignore`.

## Estructura

Al extraer, la ruta local replica la ruta de S3. Para pasar de una URL
a su archivo basta con cambiar el prefijo:

| Prefijo en S3 | Carpeta local | Imágenes |
|---|---|---|
| `https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/` | `pickbazar/` | 2954 |
| `https://s3.amazonaws.com/redqteam.com/Borobazar/` | `borobazar/` | 144 |

- Dentro de `pickbazar/` cada carpeta numérica es el id del *attachment*
  de Laravel. La imagen original va en la raíz de la carpeta y su
  miniatura en `conversions/<nombre>-thumbnail.<ext>`.
- Los nombres van decodificados: `Popcorn-%281%29.jpg` en S3 es
  `Popcorn-(1).jpg` aquí.

## `manifest.json`

Por cada imagen guarda:

- `url`: la URL original;
- `path`: la ruta relativa a esta carpeta;
- `bytes`: el tamaño;
- `refs`: los archivos del repo que la referencian.

`notDownloaded` lista las 8 URLs que no son imágenes (PDF y XLSX de
productos digitales y exportaciones), que no se copiaron.

Las URLs del código y del seed **no** se reescribieron: siguen apuntando
a S3.
