# Lipa: M-Pesa for Laravel

**Lipa gives your Laravel app all three M-Pesa money flows: STK push checkout, Paybill/Till payments, and payouts to phones. It works as skills for AI coding agents, or as plain code you copy into your project.**

Every flow ships the working code, Pest tests that run against a fresh Laravel app in CI, and the Daraja gotchas that usually cost a day each: Kenya-time timestamps, words Safaricom rejects in URLs, encrypted security credentials, callbacks that never reach localhost, and timeouts that can pay twice.

| Skill | Money flow | What happens | Tests |
|---|---|---|---|
| [`mpesa-stk-push`](skills/mpesa-stk-push/SKILL.md) | Customer → you, prompted by you | Your checkout sends an M-Pesa PIN prompt to the customer's phone | 19 |
| [`mpesa-c2b-payments`](skills/mpesa-c2b-payments/SKILL.md) | Customer → you, from their own menu | Customers pay your Paybill or Till with an account number; you validate, confirm and reconcile | 7 |
| [`mpesa-b2c-payouts`](skills/mpesa-b2c-payouts/SKILL.md) | You → customer | Refunds, withdrawals, salaries and rewards sent to phones, safely | 9 |

## Install

### With an AI agent (recommended)

```bash
# Laravel Boost (Claude Code, Cursor, Copilot, Codex, Junie...)
php artisan boost:add-skill BrivaHamisi/laravel-lipa

# Or any agent, through skills.sh
npx skills add BrivaHamisi/laravel-lipa
```

Then ask: *"Add M-Pesa STK push to the checkout"*, *"Let customers pay invoices through our Paybill"*, *"Refund orders to M-Pesa"*.

### Without an agent

Run this inside your Laravel project:

```bash
npx laravel-lipa list                  # the three skills
npx laravel-lipa add mpesa-stk-push    # or mpesa-c2b-payments, mpesa-b2c-payouts, all
php artisan migrate && php artisan test --filter=StkPush
```

It copies the code and tests into your app, adds the routes file to `routes/web.php`, and prints the next steps. Files you've changed are never overwritten unless you pass `--force`, and `--dry-run` shows what would change. The package has no dependencies and no install scripts, and needs no network access once downloaded.

Prefer not to use npm? Clone the repo, or download the [latest release](https://github.com/BrivaHamisi/laravel-lipa/releases/latest), and run `bin/install <skill|all> /path/to/your-laravel-app`.

## Quick start

**STK push.** Your checkout calls:

```js
import { payWithMpesa } from './mpesa-checkout';

const result = await payWithMpesa({ amount: 1000, phone: '0712 345 678' }, (message) => showStatus(message));
// result.status: 'completed' | 'failed' | 'pending'
```

**C2B.** Register your URLs once with `php artisan mpesa:register-c2b-urls`, then react to payments:

```php
Event::listen(function (MpesaPaymentReceived $event) {
    Invoice::firstWhere('number', $event->transaction->bill_ref_number)?->markPaid($event->transaction);
});
```

**B2C.** Pay out from your own code, after your own approval:

```php
$payout = MpesaPayout::prepare(phone: '254712345678', amount: 500, remarks: 'Refund for order 1042');
SendMpesaPayout::dispatch($payout);
// Listen for MpesaPayoutSettled to update the order.
```

## Configuration

Everything lives in `config/mpesa.php`, read from your `.env`. Values never go in code or git.

| Variable | Used by | Notes |
|---|---|---|
| `MPESA_ENVIRONMENT` | all | `sandbox` or `live` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | all | From your app on developer.safaricom.co.ke |
| `MPESA_CALLBACK_TOKEN` | all | Secret in every callback URL: `php -r "echo bin2hex(random_bytes(20));"` |
| `MPESA_CALLBACK_BASE_URL` | all | Optional public HTTPS base (e.g. a tunnel while testing); defaults to `APP_URL` |
| `MPESA_SHORTCODE` | STK, C2B | Paybill or Till store number (sandbox STK: `174379`) |
| `MPESA_PASSKEY` | STK | Lipa Na M-Pesa Online passkey |
| `MPESA_TYPE`, `MPESA_TILL_NUMBER` | STK | `paybill` or `till`; a Till needs its till number |
| `MPESA_C2B_RESPONSE_TYPE`, `MPESA_C2B_ACCOUNT_PATTERN` | C2B | What happens if validation is down; account number rule |
| `MPESA_B2C_SHORTCODE`, `MPESA_INITIATOR_NAME`, `MPESA_INITIATOR_PASSWORD` | B2C | Disbursement short code and API initiator |
| `MPESA_CERTIFICATE_PATH` | B2C | Safaricom's public certificate for the environment |

## Built to be safe

- **Callbacks are protected by a secret token** in the URL, compared in constant time. Safaricom doesn't sign callbacks.
- **Idempotent everywhere.** Duplicate STK callbacks, retried C2B confirmations and repeated B2C results change nothing, and events fire once.
- **Nothing over HTTP can send money.** B2C only has result routes. Payouts start from your own code, run once, and never auto-retry.
- **Timeouts are flagged, not retried,** because a timed-out payout may still have been paid.
- **Paid amounts are checked** against what was asked.
- **URLs avoid the words Safaricom rejects** (`mpesa`, `safaricom`, `query`...), and tests enforce it.
- **The skills tell AI agents** never to make real payments, never to ask for keys in chat, and never to write key values into files.

## Going live

1. Get a Paybill or Till (for STK and C2B) and/or a B2C short code, from Safaricom or your bank.
2. On the Daraja portal, create a production app and complete **Go Live** for each short code. Safaricom sends the passkey and the initiator details.
3. Set the live values in your server's environment, then run `php artisan mpesa:register-c2b-urls` if you use C2B.
4. Make one small real transaction in each flow, and check it's recorded with a receipt number.

Each `SKILL.md` has a full go-live checklist and the result codes you'll see.

## Develop

```bash
bin/make-test-app .test-app                  # a fresh Laravel app (once)
SHIPKIT_APP=.test-app bin/test-skill all      # each skill in its own copy of the app
php bin/check-skills                          # frontmatter, .stub naming, shared files, audit patterns
bin/sync-shared                               # after editing .shared/
npm test                                      # the npx installer
```

Code ships as `.stub` files because `boost:add-skill` doesn't download `.php` files. The shared Daraja client and config live once in `.shared/`, and are copied into each skill.

**Releasing:** bump `version` in `package.json`, commit, then publish a GitHub release tagged `v<version>`. The `publish` workflow tests the installer and publishes to npm with provenance through trusted publishing, so no npm token is stored anywhere.

## Contributing

Issues and pull requests are welcome. Good next skills: transaction status and reversals, account balance, Ratiba (standing orders), and the Airtel Money and T-Kash equivalents. New code needs Pest tests that pass on a fresh Laravel app, and no real credentials or personal data anywhere.

## Related

[Shipkit](https://github.com/BrivaHamisi/laravel-shipkit): 12 production skills for Laravel (PayPal, secrets scanning, rate limits, SEO, image uploads and more).

## License

MIT. Use it in your projects, commercial or not.
