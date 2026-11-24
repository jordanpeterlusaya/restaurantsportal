# HAUL Restaurants Portal

Static web portal for DoorDrop/HAUL restaurant partners.

## Features

- Register with phone, restaurant name, and location
- Login with phone + SMS OTP (same Firebase project as DoorDrop)
- Live `foodOrders` desk with status updates: received → preparing → ready → out for delivery → delivered
- Minimal menu management (`menuItems`)

## Local preview

No install step. From this folder:

```bash
python3 -m http.server 4174
```

Open [http://localhost:4174](http://localhost:4174).

OTP and registration call the shared DoorDrop Cloud Function API:

`https://us-central1-efootball-app-9d175.cloudfunctions.net/api`

Override locally if needed:

```html
<script>
  globalThis.DOORDROP_ADMIN_CONFIG = { apiBaseUrl: 'http://127.0.0.1:8787' };
</script>
```

## Firestore collections

- `restaurants` — restaurant profile
- `restaurantMembers` — owner membership
- `restaurantOtpSessions` — OTP sessions
- `menuItems` — dishes shown in the customer app
- `foodOrders` — orders placed from the DoorDrop customer app

## Backend routes

- `POST /restaurant-auth/otp/send`
- `POST /restaurant-auth/otp/verify`
- `POST /restaurant-auth/otp/login`
- `POST /restaurant-auth/otp/register`
- `POST /restaurant-auth/confirm-phone`
