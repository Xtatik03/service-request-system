# 🏛️ Huduma Desk — Public Service Request System

A mini eCitizen-style platform where citizens report public service issues (broken streetlights, water problems, uncollected garbage) and administrators track them from **Pending → In Progress → Resolved**.

**Live demo:** _<add deployed URL>_ · **Demo admin:** `admin@example.com` / `admin123`

## Features
| Requirement | Implementation |
|---|---|
| Citizen registration / login | bcrypt-hashed passwords, JWT sessions (7 days) |
| Submit request | Category, location, description, optional photo (image-only, max 3 MB) |
| Admin dashboard | View all requests, update status, search and filter |
| Status tracking | Visual 3-step progress tracker on every request |
| Basic analytics | Total / open / resolved counts, resolution rate, cases per category |

**Bonus features:** admin notes visible to the citizen, search + status/category filters, resolution-rate metric, role-based access control, dark mode, mobile-responsive layout, XSS-safe rendering.

## Tech stack
Node.js · Express · SQLite (`better-sqlite3`) · Multer · vanilla JS/CSS frontend (no build step).

## Project structure
```
server.js          REST API, auth, DB schema, analytics
public/index.html  App shell
public/app.js      SPA: auth, citizen & admin views
public/style.css   Styling (light/dark, responsive)
render.yaml        One-click Render deployment
```

## Run locally
```bash
git clone <repo-url> && cd service-request-system
npm install
npm start          # http://localhost:3000
```
Optional env vars: `PORT`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATA_DIR`.
An admin account is seeded on first start (`admin@example.com` / `admin123` by default — change it in production).

## API
| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/register`, `/api/login` | Public |
| GET | `/api/meta` | Public |
| POST | `/api/requests` (multipart) | Citizen |
| GET | `/api/requests?status=&category=&q=` | Citizen (own) / Admin (all) |
| PATCH | `/api/requests/:id` `{status, admin_note}` | Admin |
| GET | `/api/stats` | Admin |

## Deployment (Render)
Push to GitHub → Render → **New → Blueprint** → select the repo. `render.yaml` configures everything.
> Free-tier disks are ephemeral, so data and uploads reset on redeploy. Attach a persistent disk and set `DATA_DIR` for production.

## Design decisions
- Authorisation is enforced on the server (`auth` / `adminOnly` middleware), not just hidden in the UI.
- All SQL uses parameterised queries; user content is HTML-escaped before rendering.
- SQLite keeps setup to zero external services.
