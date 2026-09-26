---
name: mpesa-c2b-payments
description: "Receive M-Pesa Paybill and Till payments that customers make from their own phone menu (Daraja C2B) in Laravel: register validation and confirmation URLs, accept or reject payments by account number and amount, store each transaction exactly once, and fire an event to mark invoices paid. Use when adding Lipa na M-Pesa Paybill/Till, C2B, register URL, confirmation or validation callbacks, or reconciling M-Pesa payments to invoices or orders."
license: MIT
metadata:
  author: BrivaHamisi
---

# M-Pesa C2B: Paybill and Till payments

Customers pay from **their own M-Pesa menu**: Lipa na M-Pesa → Pay Bill → your short code → account number (your invoice or order number). Safaricom tells your app about each payment:

1. **Validation** (optional, and only if Safaricom enables external validation on the short code): "should I accept this?" You answer accept, or reject with a reason code.
2. **Confirmation:** "this payment went through." The app stores it once and fires `MpesaPaymentReceived`.

## What you get

Copy every file in `stubs/` to the same path, dropping `.stub`:

| File | Purpose |
|---|---|
| `config/mpesa.php`, `app/Support/Mpesa/Daraja.php` | Shared settings and Daraja client (identical across the M-Pesa skills) |
| `app/Support/Mpesa/C2b.php` | Register URLs, validation rules, Kenya-time parsing |
| `app/Http/Controllers/Mpesa/C2bController.php` | Validation and confirmation endpoints |
| `routes/mpesa-c2b.php` | `/payments/c2b/validate/{token}` and `/payments/c2b/confirm/{token}` |
| `app/Console/Commands/RegisterMpesaC2bUrls.php` | `php artisan mpesa:register-c2b-urls` |
| `app/Models/MpesaTransaction.php`, migration, factory | One row per M-Pesa receipt (`trans_id` is unique) |
| `app/Events/MpesaPaymentReceived.php` | Fired once per new payment |
| `tests/Feature/C2bPaymentsTest.php` | 7 Pest tests |

## Steps

1. Copy the stubs, add `require __DIR__.'/mpesa-c2b.php';` to `routes/web.php`, and run `php artisan migrate`.
2. Add `MPESA_ENVIRONMENT`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE` and `MPESA_CALLBACK_TOKEN` **with empty values** to `.env.example`. Optionally add `MPESA_C2B_ACCOUNT_PATTERN` and `MPESA_C2B_RESPONSE_TYPE`. The owner fills in their own `.env`.
3. Listen for payments, for example in a listener class:
   ```php
   public function handle(MpesaPaymentReceived $event): void
   {
       $invoice = Invoice::firstWhere('number', $event->transaction->bill_ref_number);

       if ($invoice && (float) $event->transaction->amount >= (float) $invoice->balance) {
           $invoice->markPaid($event->transaction);
       }
   }
   ```
   Payments that don't match anything stay in `mpesa_transactions` for manual reconciliation: build an admin list of unmatched payments.
4. If you validate: set `MPESA_C2B_ACCOUNT_PATTERN` (e.g. `/^INV-\d+$/`), or extend `C2b::rejectionFor()`. Keep it fast, with no external calls: Safaricom waits only a few seconds.
5. The owner runs `php artisan mpesa:register-c2b-urls` once per environment, and again whenever the domain changes.
6. Run `php artisan test --filter=C2b`.

## Agent safety

- Build and test with `Http::fake()` and fake callbacks. **Don't register URLs against Safaricom or call the live API yourself.** The owner runs the register command.
- **Never ask for keys in the chat, and never write key values into files.** Don't read, print or copy `.env`.
- Payment payloads contain customers' names and phone data. Don't print stored transactions into the conversation.

## Gotchas

- **Validation is off unless Safaricom turns it on** for the short code (ask them for "external validation"). Until then, only the confirmation URL is called, and every payment is accepted.
- **`ResponseType`** decides what happens when your validation URL is down: `Completed` accepts, `Cancelled` rejects. Most businesses choose `Completed`, so money is never refused because of an outage.
- **Rejection codes:** `C2B00011` invalid phone, `C2B00012` invalid account number, `C2B00013` invalid amount, `C2B00014` invalid KYC details, `C2B00015` invalid short code, `C2B00016` other error.
- **Store once per `TransID`.** Safaricom retries confirmations. The unique `trans_id` plus `firstOrCreate` makes retries harmless, and the event fires only for new rows.
- **Always answer `ResultCode` `0` on confirmation,** even for payments you can't match. The money has already moved; reconcile it yourself.
- **Customers mistype account numbers.** Match case-insensitively and ignore spaces (`strtoupper(str_replace(' ', '', $ref))`) before giving up.
- **`MSISDN` may arrive masked or hashed.** Safaricom hides customer phone numbers on some C2B products. Store what arrives, and don't rely on it to identify people.
- **`TransTime`** is `YmdHis` in Kenya time. It's stored as UTC.
- **URLs must be public HTTPS** in production, and must not contain `mpesa`, `m-pesa`, `safaricom`, `exe`, `exec`, `cmd`, `sql` or `query`, or registration fails. The routes use `/payments/c2b/...`.
- **Sandbox:** register URLs on the test short code, then send test payments with the C2B simulator on the Daraja portal.
