---
name: mpesa-b2c-payouts
description: "Send money from a business to customers' M-Pesa phones in Laravel with Daraja B2C (refunds, withdrawals, salaries, rewards): encrypted security credential, queued single-attempt sending, result and timeout callbacks, idempotent OriginatorConversationID, and safe handling of timeouts so nobody is paid twice. Use when adding M-Pesa payouts, disbursements, B2C, refunds to M-Pesa, withdrawals to phone, or fixing B2C security credential, initiator or result URL problems."
license: MIT
metadata:
  author: BrivaHamisi
---

# M-Pesa B2C payouts

Your business sends money to a phone: a refund, a wallet withdrawal, a salary or a reward. Because this moves money **out**, the design is conservative:

- **Nothing over HTTP can start a payout.** The only routes are Safaricom's result callbacks. Payouts start from your own code, typically after an admin approves them.
- **One attempt per payout.** The job runs once. A failure is recorded for a person to review, and never retried automatically.
- **Timeouts are not failures.** When Safaricom's queue times out, the money may still move. The payout is flagged `timed_out` for someone to check on the M-Pesa portal before paying again.
- **Every request carries our own ID** (`OriginatorConversationID`), so Safaricom can recognise a duplicate.

## What you get

Copy every file in `stubs/` to the same path, dropping `.stub`:

| File | Purpose |
|---|---|
| `config/mpesa.php`, `app/Support/Mpesa/Daraja.php` | Shared settings and client, including `securityCredential()` |
| `app/Support/Mpesa/B2c.php` | The payout request (Daraja B2C v3) |
| `app/Models/MpesaPayout.php`, `app/Enums/PayoutStatus.php`, migration, factory | Payouts and their states |
| `app/Jobs/SendMpesaPayout.php` | Sends one prepared payout, once |
| `app/Http/Controllers/Mpesa/B2cCallbackController.php`, `routes/mpesa-b2c.php` | Result and timeout callbacks |
| `app/Events/MpesaPayoutSettled.php` | Fired once when a payout completes or fails |
| `tests/Feature/B2cPayoutsTest.php` | 9 Pest tests, including real encryption with a throwaway certificate |

## Steps

1. Copy the stubs, add `require __DIR__.'/mpesa-b2c.php';` to `routes/web.php`, and run `php artisan migrate`. A queue worker must be running for `SendMpesaPayout`.
2. Add **with empty values** to `.env.example` (the owner fills in their own `.env`): `MPESA_ENVIRONMENT`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_CALLBACK_TOKEN`, `MPESA_B2C_SHORTCODE`, `MPESA_INITIATOR_NAME`, `MPESA_INITIATOR_PASSWORD` and `MPESA_CERTIFICATE_PATH`.
3. The owner downloads Safaricom's public certificate for the environment (sandbox or production `.cer`) from the Daraja portal. They store it outside `public/`, for example in `storage/app/private/mpesa/`, and set `MPESA_CERTIFICATE_PATH`.
4. Pay out from your own code, after your own checks and approval:
   ```php
   $payout = MpesaPayout::prepare(phone: '254712345678', amount: 500, remarks: 'Refund for order 1042');
   $payout->payable()->associate($order)->save();
   SendMpesaPayout::dispatch($payout);
   ```
   Listen for `MpesaPayoutSettled` to update the order and notify the customer.
5. Run `php artisan test --filter=B2c`.

## Agent safety

- **Never send a payout, and never call the live API yourself.** Build and test with `Http::fake()`. Real payouts happen only when the owner's running app dispatches `SendMpesaPayout`.
- **Don't add a route, API endpoint or admin button that sends money without an approval step** and an authorisation check (a policy or gate, e.g. only finance admins). Put per-payout and daily limits in your own code.
- **Never ask for or handle the initiator password, keys or certificate contents in the chat,** and never write them into files. Only variable names with empty values go in `.env.example`. Don't read, print or copy `.env`.

## Gotchas

- **SecurityCredential** is the initiator password encrypted with Safaricom's **public certificate** (RSA, PKCS#1 v1.5 padding), then base64-encoded. Sandbox and production have **different certificates**, so a mismatch gives "The initiator information is invalid" (2001). A new credential is generated for every request.
- **The initiator** is an API user created on the M-Pesa organisation portal with the "B2C ORG API initiator" role. It's not your Daraja login.
- **The B2C short code differs from your Paybill.** B2C needs its own disbursement short code, funded through its utility account.
- **`CommandID`** is `BusinessPayment` (general), `SalaryPayment` (salaries, including to unregistered users) or `PromotionPayment` (rewards). The wrong one gets rejected.
- **The immediate response only means "queued".** `ResponseCode` `0` doesn't mean paid. The result arrives on the `ResultURL`, usually within seconds, sometimes much later.
- **Result codes:** 0 success, 1 insufficient balance in the utility account, 2001 wrong initiator credentials, 2040 recipient not registered or not allowed, 8006 security credential locked.
- **Timeouts:** before paying a `timed_out` payout again, check the transaction on the M-Pesa portal, or use Daraja's Transaction Status API with the `conversation_id`. A late result still settles the payout, and the tests prove it.
- **Keep an eye on the balance:** results include `B2CUtilityAccountAvailableFunds`. Alert when it runs low, or payouts start failing with code 1.
- **URLs** must be public HTTPS and avoid `mpesa`, `safaricom`, `query` and similar words. The routes use `/payments/b2c/...`.
