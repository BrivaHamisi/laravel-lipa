---
name: mpesa-stk-push
description: "Take M-Pesa payments in Laravel with Safaricom Daraja STK push (Lipa Na M-Pesa Online): send the PIN prompt to the customer's phone, receive the callback, poll the status from the browser, and go live. Use when adding M-Pesa checkout, Daraja STK push, Paybill or Till payments, mobile money in Kenya, or debugging STK callbacks, timestamps, passwords or result codes."
license: MIT
metadata:
  author: BrivaHamisi
---

# M-Pesa STK push

The customer types their phone number, gets an M-Pesa PIN prompt, and your app records the result from Safaricom's callback. If the callback never arrives, it falls back to Daraja's status query.

## What you get

Copy every file in `stubs/` to the same path in the app, **dropping the `.stub` suffix**.

| File | Purpose |
|---|---|
| `config/mpesa.php` | All M-Pesa settings (shared by the C2B and B2C skills) |
| `app/Support/Mpesa/Daraja.php` | Shared Daraja client: token caching, callback URLs, phone numbers (shared) |
| `app/Support/Mpesa/StkPush.php` | Send the prompt, query its status, explain result codes |
| `app/Http/Controllers/Mpesa/StkPushController.php` | Start a payment, status polling, Safaricom's callback |
| `routes/mpesa-stk.php` | The three routes. `require` it from `routes/web.php` |
| `app/Models/Payment.php`, `app/Enums/PaymentStatus.php`, migration, factory | A `payments` table with safe status transitions |
| `resources/js/mpesa-checkout.js` | `payWithMpesa()`: start the payment and poll until it finishes |
| `tests/Feature/StkPushTest.php` | 19 Pest tests using `Http::fake()` |

If `config/mpesa.php` or `app/Support/Mpesa/Daraja.php` already exist from another M-Pesa skill, keep them: they're identical.

## Steps

1. Copy the stubs, add `require __DIR__.'/mpesa-stk.php';` to `routes/web.php`, and run `php artisan migrate`.
2. Add these keys **with empty values** to `.env.example`. The owner fills in their own `.env`:
   ```dotenv
   MPESA_ENVIRONMENT=sandbox
   MPESA_CONSUMER_KEY=
   MPESA_CONSUMER_SECRET=
   MPESA_SHORTCODE=
   MPESA_PASSKEY=
   MPESA_TYPE=paybill
   MPESA_CALLBACK_TOKEN=
   ```
   The owner gets sandbox keys from their own app at developer.safaricom.co.ke (the sandbox short code is `174379`, and the sandbox passkey is on the Daraja STK push simulator page). They generate the callback token locally with `php -r "echo bin2hex(random_bytes(20));"`.
3. Run `php artisan test --filter=StkPush`.
4. Build the checkout with `payWithMpesa({ amount, phone }, onStatus)` from `resources/js/mpesa-checkout.js`. Or post to `route('mpesa.stk.store')` and poll the returned `status_url` every 4 seconds.

## Agent safety

- This skill writes integration code and tests. **Never send a real prompt or call the live API yourself**: the tests use `Http::fake()`, and real prompts are only sent by the running app when a customer pays, in sandbox until the owner switches to live.
- **Never ask the user to paste keys into the chat, and never write key values into any file.** Only variable names with empty values go in `.env.example`. Don't read, print or copy `.env`.

## Rules that matter

- **Never trust an amount from the browser for priced things.** The controller takes `amount` from the request, which is right for donations. For orders or invoices, compute it on the server, and attach the payment to the order through the `payable` morph relation.
- **The callback is the source of truth,** but it can't reach `localhost` and is sometimes late. After 20 pending seconds, the status endpoint asks Daraja directly.
- **Check the paid amount in the callback.** A callback `Amount` smaller than the payment fails it, whatever the result code says.
- **Callbacks carry a secret token** in the URL, compared with `hash_equals`, because Safaricom doesn't sign callbacks. They're exempt from CSRF, and always answer `{"ResultCode":0}` so Safaricom stops retrying.
- **Completed is final.** `markCompleted()` also rescues a payment wrongly marked failed or abandoned, but nothing overrides a completed payment. Duplicate callbacks are harmless.
- **Put a UUID `reference` in URLs,** never the numeric ID.

## Daraja gotchas

- **Callback URLs must not contain** `mpesa`, `m-pesa`, `safaricom`, `exe`, `exec`, `cmd`, `sql` or `query`. That's why the routes live under `/payments/stk/...`. A test enforces it.
- **The timestamp** must be Kenya time (`Africa/Nairobi`) as `YmdHis`, whatever your app's timezone. A UTC timestamp gives "Invalid Timestamp" or a wrong-password error.
- **Password** = `base64(shortcode + passkey + timestamp)`, with the same timestamp sent in the request.
- **Till vs Paybill:** a Till uses `CustomerBuyGoodsOnline` with `PartyB` set to the **till number**, not the store short code. A Paybill uses `CustomerPayBillOnline` with the short code in both fields.
- **Phones** must be `2547XXXXXXXX` or `2541XXXXXXXX`. `Daraja::normalizePhone()` accepts `07...`, `01...`, `+254...` and spaces.
- **Whole shillings only.** `AccountReference` is at most 12 characters, and `TransactionDesc` at most 13.
- **While the customer is still deciding,** the status query returns HTTP 500 with `errorCode` `500.001.1001`. That means pending.
- **Result codes:** 0 paid, 1 insufficient balance, 1032 cancelled, 1037 timed out (phone unreachable), 2001 wrong PIN.

## Testing a real prompt (the developer, by hand)

Safaricom must reach the callback over public HTTPS. The developer can expose their local site through a tunnel service they already use and set `MPESA_CALLBACK_BASE_URL` to its `https://` address. Without a tunnel, the status-query fallback still completes sandbox payments after about 20 seconds.

## Going live (the owner)

1. Get a Paybill or Till with Lipa Na M-Pesa Online enabled.
2. On the Daraja portal, create a production app and use **Go Live** for the short code. The live passkey arrives by email.
3. Set `MPESA_ENVIRONMENT=live` and the live values. The callback URL must be public HTTPS, with no login or basic auth in front of it.
4. Make one small real payment, and check that it's marked completed with a receipt number.
