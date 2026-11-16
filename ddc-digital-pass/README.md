# The Daily Drip Cafe — Digital Pass

A mobile-first digital pass and staff redemption system. Customers scan one campaign QR, register once per mobile number, receive a unique pass and QR, and staff verify/redeem it from a password-protected dashboard.

## Important before going live
- The offer is currently configured as **“A complimentary treat”** with wording asking customers to confirm the eligible item with the cafe team. Replace this with the exact complimentary item and any minimum-spend/other conditions before publishing.
- Validity is configured through **30 November 2026**. The staff verification and redemption endpoints automatically block redemption after this date.
- The form collects name and mobile number but does not perform SMS OTP verification. One pass per entered mobile number is enforced, but customers could enter another number.
- Use HTTPS in production. Camera QR scanning generally requires HTTPS and camera permission.
- Keep the staff password private. Do not share the staff dashboard link/password with customers.

## Run locally
Requires Node.js 20+.
```bash
npm install
cp .env.example .env
```
Set `BASE_URL=http://localhost:3000`, a strong `ADMIN_PASSWORD`, and a long random `SESSION_SECRET`. Load environment variables (for example with `export $(grep -v '^#' .env | xargs)` on a compatible shell), then:
```bash
npm start
```
Open `http://localhost:3000`. Customer claim page: `/claim`. Staff dashboard: `/staff/login`.

## Deploy
1. Create a GitHub repository and upload these project files.
2. Create a Render web service from the repository, or use the included `render.yaml` Blueprint.
3. Attach a persistent disk mounted at `/var/data`.
4. Set `BASE_URL` to the final HTTPS service URL (for example `https://your-service.onrender.com`).
5. Set a strong `ADMIN_PASSWORD`.
6. Keep the generated `SESSION_SECRET`.
7. Deploy and test a customer claim and a staff redemption before printing the campaign QR.

## Campaign QR
After deployment, generate a QR code that points to:
`https://YOUR-DOMAIN/claim`
This is the single reusable campaign QR for posters/table tents. Each successful registration creates a separate personal pass and pass QR.

## Staff workflow
1. Open `/staff/login` on a staff phone.
2. Sign in with the staff password and staff name.
3. Scan the customer's personal pass QR with the dashboard camera, or enter the DDC code printed under the QR.
4. Check the customer name and confirm redemption.
5. The pass becomes redeemed; a second attempt is blocked.

## Data and security notes
- Pass records and staff sessions are stored in SQLite on the persistent disk.
- Staff verification and redemption endpoints require a staff session.
- Redemption uses a conditional database update so simultaneous attempts cannot redeem the same pass twice.
- This starter does not include OTP verification, consent management beyond the form notice, automated expiry blocking, exports, or automated analytics. Add these before a larger public campaign if required.
