# Market Hub

Market Hub is local-marketplace app. The existing React/Vite + Express/SQLite architecture is preserved; the implementation now adds real authentication, role checks, dynamic business hours, inventory freshness, reviews, saves, notifications, business management, moderation, and demand analytics.

## Run locally

### Backend
```bash
cd backend
npm install
npm start
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://localhost:5000/api`. Override it with `VITE_API_BASE` if needed.

## Demo accounts

- Customer: `demo@gramsetu.app` / `Demo@12345`
- Business owner: `business@gramsetu.app` / `Business@12345`
- Admin: `admin@gramsetu.app` / `Admin@12345`

The demo emails intentionally retain the original demo credentials while the product branding is now Market Hub.

## Main changes

- Market Hub branding and responsive desktop/mobile layout
- Customer, business-owner and admin roles with backend authorization
- Working demo login and session tokens
- Product/service search, category filters and product-name matching
- Dynamic weekly opening hours with closed days, closing-soon and overnight support
- Business hours editor
- Inventory status updates with freshness timestamps and stale-data warnings
- Fixed, starting, range/from and price-on-request display types
- Saved businesses/products
- Reviews, review responses and reports
- Notification center
- Business profile editing and inventory management
- Business claims and admin approval workflow
- Admin moderation overview, claims and reports
- Aggregated demand insights with a minimum privacy threshold
- Light/dark/system theme persistence
- English/Hindi-ready UI structure
- Loading, empty and error states
- Home-service business fields
- Profile completeness tracking

## Note about the supplied archive

The original archive included Windows-native `node_modules` binaries. They should not be relied on across operating systems. The source and lockfiles are the important project artifacts; run `npm install`/`npm ci` on the target machine so Vite/Rollup/sqlite3 install the correct native binaries for that OS.

## Location & Google Maps

Market Hub supports customer location using the browser Geolocation API and map-selected locations. The backend accepts `lat` and `lng` on `/api/businesses` and recalculates business distance from the customer location when coordinates are available.

To enable the live Google Map:

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Set `VITE_GOOGLE_MAPS_API_KEY` to your Google Maps JavaScript API key.
3. In Google Cloud, enable **Maps JavaScript API** for that key and configure appropriate website/API-key restrictions.
4. Restart the Vite dev server after changing `.env`.

The map shows the customer location, nearby business markers, and (for Home Services) a coverage circle for each provider based on `max_service_radius`. Customers can click the map to pin a different location or use their current browser location.
