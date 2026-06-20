# Atelier

An open-source web-based painting application built with Vue 3 + Vite.
Multi-layer drawing with various tools, IPFS backup, and PWA support — works on desktop and mobile.

**Live demo:** [atelier.re95.org](https://atelier.re95.org)

## Features

- **Drawing Tools** — Pencil, brush, eraser, line, rectangle, circle, fill bucket, eyedropper, text
- **Selection Tools** — Rectangular select, lasso, magic wand (with float/move support)
- **Layers** — Add, delete, duplicate, merge, reorder, opacity control
- **Sticky Notes** — Draggable, resizable, minimizable floating text notes
- **Color Palette** — Custom colors, brush size and opacity controls
- **Canvas Zoom & Rotation** — Zoom in/out and freely rotate the viewport
- **IPFS Backup** — Back up and restore your canvas to/from IPFS via Pinata or a local node
- **Persistent Storage** — Canvas data auto-saved to IndexedDB; survives page refreshes
- **PWA** — Installable as a standalone app with offline support
- **Touch Support** — Full touch drawing on mobile browsers
- **i18n** — English and Traditional Chinese

## Tech Stack

- [Vue 3](https://vuejs.org/) with `<script setup>`
- [Vite](https://vitejs.dev/) + [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- [Pinia](https://pinia.vuejs.org/) + `pinia-plugin-persistedstate`
- [Lucide Vue Next](https://lucide.dev/) icons
- Canvas 2D API, IndexedDB

## Getting Started

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build → ./dist/
npm run preview  # preview the production build
```

## Deployment

### Quick (any static server)

```bash
npm run build
npx serve dist
```

### nginx

1. Copy `dist/` to your web root:

```bash
sudo cp -r dist/. /var/www/your-domain.com/
```

2. nginx server block:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/your-domain.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

3. Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### One-click deploy scripts

Copy the env template and fill in your credentials:

```bash
cp .env.deploy.example .env.deploy
# edit .env.deploy with your SITE_DOMAIN, Pinata JWT, Cloudflare keys
```

Then deploy:

```bash
./deploy.sh        # build + nginx + purge Cloudflare cache
./deploy-ipfs.sh   # build + Pinata upload + Cloudflare Worker (no server needed)
```

`deploy-ipfs.sh` uploads `dist/` to Pinata IPFS and deploys a Cloudflare Worker that proxies traffic to the pinned CID — the site stays online without your computer running.
Run `./deploy.sh` to revert back to nginx at any time.

See `.env.deploy.example` for the full list of required environment variables and Cloudflare API token permissions.

### Docker

```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
```

```bash
npm run build && docker build -t atelier . && docker run -p 8080:80 atelier
```

## License

MIT
