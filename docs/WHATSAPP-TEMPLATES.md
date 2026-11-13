# WhatsApp templates: registration guide

> Generated from `apps/api/src/modules/notifications/templates/templates.ts` (with `variables.ts`
> and `meta-whatsapp.adapter.ts`). Regenerate this file whenever a template's `version` changes.
> Generated 5 Nov 2026. Each block gives the template's version.

WhatsApp sends a business-started message only on a template Meta has approved. Clickco has 19
WhatsApp templates: every template whose channels include `WHATSAPP`. `PRO_NEW_OFFER` is push
only. OTPs go by SMS only. The SMS side is in `docs/DLT-TEMPLATES.md`.

## Before you start

**The button's base URL must match `PUBLIC_WEB_URL`.** Only `photos_delivered_v1` has a button.
The SMS link follows `PUBLIC_WEB_URL`; the WhatsApp link is fixed in the approved template.
DEPLOY.md lists `https://clickco.in` for production. While the site lives on
`https://clickco-web.vercel.app`, use that for both.

## Steps

### 1. WhatsApp Business Account

1. Open a Meta Business portfolio at https://business.facebook.com, in the company's name.
2. Start business verification there (Business settings, Security Center). Until it passes, Meta
   caps how many people you can message a day.
3. Create the WhatsApp Business Account in WhatsApp Manager
   (https://business.facebook.com/wa/manage). Meta may ask you to create a Meta developer app with
   the WhatsApp product; that is fine.
4. Add a payment method in WhatsApp Manager. Meta bills each template message it delivers.

### 2. The phone number

1. Use a number the company owns that can receive an SMS or a call.
2. It must not be on the WhatsApp or WhatsApp Business app. If it is, delete that WhatsApp account
   first.
3. In WhatsApp Manager, open Phone numbers and add it. Verify it with the code.
4. Set the display name to `Clickco`. Meta reviews it against the brand and website.
5. Set the two-step PIN when asked, and keep it in the password manager.

### 3. Submit each template in WhatsApp Manager

1. Open Message templates, then Create template.
2. **Category: Utility**, for all 19. templates.ts says every template, `transactional` or
   `utility`, registers with Meta as UTILITY, and none is marketing.
3. **Name:** the block's `whatsappName`, exactly. The API sends this name.
4. **Language: English**, code `en`. Not "English (US)" or "English (UK)". The API asks for `en`,
   and a template in another English variant does not match (Meta error 132001).
5. **Body:** paste the block's body. Add no header and no footer. The API sends only the body
   values and, for one template, the button value.
6. **Samples:** Meta asks for a sample for each `{{n}}`. Use the block's sample values.
7. **Button:** only for `photos_delivered_v1`. The block gives every field.
8. Submit. Approval usually takes minutes, sometimes up to a day or two.

### 4. After approval

| Value | Where it comes from | Where it goes |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | developers.facebook.com, your app, WhatsApp, API Setup: "Phone number ID" (digits). Not the phone number itself. | Paste to Claude |
| `WHATSAPP_ACCESS_TOKEN` | Business settings, Users, System users. Add an admin system user. Give it your app and the WhatsApp account. Generate a token that never expires, with `whatsapp_business_messaging` and `whatsapp_business_management`. | **Doppler only.** Never in chat, a file or git. |

For `WHATSAPP_ACCESS_TOKEN`: open the Doppler dashboard, project `clickco-api`, config `prd` (and
your staging config, if you run one), and add the secret there. Do not use the 24-hour token from
API Setup.

`WHATSAPP_ADAPTER=meta` is already in DEPLOY.md. Leave `WHATSAPP_GRAPH_VERSION` at its default.

## Meta rules

- **Name:** lowercase letters, digits and underscores. Every `whatsappName` already fits.
- **Variables** are `{{1}}`, `{{2}}` and so on, in order. The API fills them in `bodyOrder`.
- **No variable at the very start or the very end of the body.** A full stop after the last
  variable is enough at the end.
- **No two variables side by side.**
- Every body below passes these three rules. `templates.test.ts` checks them for each template.
- **A sample for every variable**, including the button's.
- **Enough fixed words around the variables.** Meta refuses a body that is mostly variables. Ours
  are fine.
- **Utility means about something the person already started**: a booking, a payment, a payout. No
  offers. If Meta moves a template to Marketing, do not accept it; tell Claude. `credit_issued_v1`
  ("It is applied at your next booking.") is the likeliest to be questioned.

## Templates

### 1. `booking_confirmed_v1` (BOOKING_CONFIRMED v1)

- **Name:** `booking_confirmed_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your Clickco booking {{1}} for {{2}} is confirmed. We will share your photographer once one is assigned.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `when` | `Sat 14 Nov, 4:30 pm` |

Button: none.

### 2. `photographer_assigned_v2` (PHOTOGRAPHER_ASSIGNED v2)

- **Name:** `photographer_assigned_v2`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your photographer {{1}} will shoot your booking {{2}} on {{3}}. Call them from the Clickco app: calls show {{4}} and your number stays private.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `photographerName` | `Priya` |
| `{{2}}` | `bookingRef` | `CLK-104237` |
| `{{3}}` | `when` | `Sat 14 Nov, 4:30 pm` |
| `{{4}}` | `callNumber` | `+918041234567` |

Button: none.

### 3. `photographer_on_the_way_v2` (PHOTOGRAPHER_ON_THE_WAY v2)

- **Name:** `photographer_on_the_way_v2`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your photographer {{1}} is on the way to your Clickco shoot {{2}}.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `photographerName` | `Priya` |
| `{{2}}` | `bookingRef` | `CLK-104237` |

Button: none.

### 4. `photographer_checked_in_v2` (CHECKED_IN v2)

- **Name:** `photographer_checked_in_v2`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your photographer {{1}} has arrived for your Clickco shoot {{2}}.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `photographerName` | `Priya` |
| `{{2}}` | `bookingRef` | `CLK-104237` |

Button: none.

### 5. `extension_requested_v1` (EXTENSION_REQUESTED v1)

- **Name:** `extension_requested_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your photographer asked to extend shoot {{1}} by {{2}} minutes for {{3}}. Approve or decline in the Clickco app within 10 minutes.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `minutes` | `30` |
| `{{3}}` | `amount` | `₹750` |

Button: none.

### 6. `shoot_complete_v1` (CHECKED_OUT v1)

- **Name:** `shoot_complete_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your Clickco shoot {{1}} is complete. We will message you as soon as your photos are ready.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |

Button: none.

### 7. `balance_due_v1` (BALANCE_DUE v1)

- **Name:** `balance_due_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your photos for {{1}} have passed our quality check. Pay the balance of {{2}} in the Clickco app to receive them.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `amount` | `₹5,767.25` |

Button: none.

### 8. `balance_reminder_v1` (BALANCE_REMINDER v1)

- **Name:** `balance_reminder_v1`
- **Category:** Utility (templates.ts: `utility`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Reminder: your photos for {{1}} are waiting. Pay the balance of {{2}} in the Clickco app to receive them.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `amount` | `₹5,767.25` |

Button: none.

### 9. `photos_delivered_v1` (DELIVERED v1)

- **Name:** `photos_delivered_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.
- **Body source:** `whatsappText` in templates.ts. It differs from the SMS text because the link travels in the button, never in the body.

Body:

```text
Your photos for {{1}} are ready.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |

Button (the only template with one):

| Field | Value |
|---|---|
| Button type | Call to action, Visit website |
| Button text | `View photos` (our suggestion; not in the code; 25 characters at most) |
| URL type | Dynamic |
| URL (fixed base and dynamic suffix) | `https://clickco-web.vercel.app/d/{{1}}` |
| Suffix variable | `linkToken`: 43 characters, letters, digits, `-` and `_` |
| Sample URL | `https://clickco-web.vercel.app/d/q7Lw2mZx9VbR4tKp0sYcN8eHjD3fUa6gT1oQiE5rXnM` |

### 10. `refund_issued_v2` (REFUND_ISSUED v2)

- **Name:** `refund_issued_v2`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
A refund of {{1}} for booking {{2}} has been processed. It can take 7–10 working days to reach your account.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `amount` | `₹2,000` |
| `{{2}}` | `bookingRef` | `CLK-104237` |

Button: none.

### 11. `booking_cancelled_v1` (BOOKING_CANCELLED v1)

- **Name:** `booking_cancelled_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your Clickco booking {{1}} for {{2}} has been cancelled as you asked. Any refund due is on its way to your original payment method, and we will message you when it is processed.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `when` | `Sat 14 Nov, 4:30 pm` |

Button: none.

### 12. `data_loss_client_v1` (DATA_LOSS_CLIENT v1)

- **Name:** `data_loss_client_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
We are sorry: the photos from your Clickco shoot {{1}} could not be recovered. A refund of {{2}} is on its way to your original payment method, and we will message you when it is processed.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |
| `{{2}}` | `amount` | `₹8,500` |

Button: none.

### 13. `partial_data_loss_client_v1` (PARTIAL_DATA_LOSS_CLIENT v1)

- **Name:** `partial_data_loss_client_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
We are sorry: some of the photos from your Clickco shoot {{1}} could not be recovered. You will get a refund for the part that was lost, and the rest of your photos will be delivered as usual.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `bookingRef` | `CLK-104237` |

Button: none.

### 14. `credit_issued_v1` (CREDIT_ISSUED v1)

- **Name:** `credit_issued_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
You have {{1}} of Clickco credit, valid until {{2}}. It is applied at your next booking.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `amount` | `₹500` |
| `{{2}}` | `expiresOn` | `5 Nov 2027` |

Button: none.

### 15. `ticket_received_v1` (TICKET_RECEIVED v1)

- **Name:** `ticket_received_v1`
- **Category:** Utility (templates.ts: `transactional`, to the client)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
We have received your Clickco support request {{1}}. Our team will reply by {{2}}. You can follow it in the Clickco app.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `ticketRef` | `TKT-1043` |
| `{{2}}` | `replyBy` | `Fri 6 Nov, 11:00 am` |

Button: none.

### 16. `pro_job_cancelled_v1` (PRO_JOB_CANCELLED v1)

- **Name:** `pro_job_cancelled_v1`
- **Category:** Utility (templates.ts: `transactional`, to the photographer)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
The client cancelled your Clickco job on {{1}}. It is off your schedule, and any payout owed for it will show in Earnings in Clickco Pro.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `when` | `Sun 15 Nov, 10:00 am` |

Button: none.

### 17. `pro_payout_paid_v1` (PRO_PAYOUT_PAID v1)

- **Name:** `pro_payout_paid_v1`
- **Category:** Utility (templates.ts: `transactional`, to the photographer)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Clickco has paid you {{1}} (bank reference ending {{2}}). See Earnings in Clickco Pro for details.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `amount` | `₹12,450` |
| `{{2}}` | `utrLast4` | `4821` |

Button: none.

### 18. `pro_payout_on_hold_v1` (PRO_PAYOUT_ON_HOLD v1)

- **Name:** `pro_payout_on_hold_v1`
- **Category:** Utility (templates.ts: `transactional`, to the photographer)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your Clickco payout of {{1}} for the shoot on {{2}} is on hold while our team reviews it. We will message you when it is released.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `amount` | `₹3,200` |
| `{{2}}` | `shootDate` | `31 Oct 2026` |

Button: none.

### 19. `pro_payout_released_v1` (PRO_PAYOUT_RELEASED v1)

- **Name:** `pro_payout_released_v1`
- **Category:** Utility (templates.ts: `transactional`, to the photographer)
- **Language:** English (`en`)
- **Meta rules:** OK. No variable at the start or end, none side by side.

Body:

```text
Your Clickco payout of {{1}} for the shoot on {{2}} has been released. It will be paid in an upcoming weekly payout.
```

| Variable | Our name | Sample value |
|---|---|---|
| `{{1}}` | `amount` | `₹3,200` |
| `{{2}}` | `shootDate` | `31 Oct 2026` |

Button: none.

## When the site moves to clickco.in

1. Edit the approved `photos_delivered_v1` in WhatsApp Manager. Change the button URL to
   `https://clickco.in/d/{{1}}` and resubmit. The name stays, so the code does not change.
2. Change `PUBLIC_WEB_URL` to `https://clickco.in` at the same time, so SMS and WhatsApp agree.
3. If Meta will not allow the edit, submit `photos_delivered_v2` instead. That needs a code
   change (version 2 and the new name).
4. Whitelist `https://clickco.in` on the DLT portal first (`docs/DLT-TEMPLATES.md`).

## Status tracker

| # | Name to submit | Template code | Version | Submitted | Approved |
|---|---|---|---|---|---|
| 1 | `booking_confirmed_v1` | `BOOKING_CONFIRMED` | 1 | | |
| 2 | `photographer_assigned_v2` | `PHOTOGRAPHER_ASSIGNED` | 2 | | |
| 3 | `photographer_on_the_way_v2` | `PHOTOGRAPHER_ON_THE_WAY` | 2 | | |
| 4 | `photographer_checked_in_v2` | `CHECKED_IN` | 2 | | |
| 5 | `extension_requested_v1` | `EXTENSION_REQUESTED` | 1 | | |
| 6 | `shoot_complete_v1` | `CHECKED_OUT` | 1 | | |
| 7 | `balance_due_v1` | `BALANCE_DUE` | 1 | | |
| 8 | `balance_reminder_v1` | `BALANCE_REMINDER` | 1 | | |
| 9 | `photos_delivered_v1` | `DELIVERED` | 1 | | |
| 10 | `refund_issued_v2` | `REFUND_ISSUED` | 2 | | |
| 11 | `booking_cancelled_v1` | `BOOKING_CANCELLED` | 1 | | |
| 12 | `data_loss_client_v1` | `DATA_LOSS_CLIENT` | 1 | | |
| 13 | `partial_data_loss_client_v1` | `PARTIAL_DATA_LOSS_CLIENT` | 1 | | |
| 14 | `credit_issued_v1` | `CREDIT_ISSUED` | 1 | | |
| 15 | `ticket_received_v1` | `TICKET_RECEIVED` | 1 | | |
| 16 | `pro_job_cancelled_v1` | `PRO_JOB_CANCELLED` | 1 | | |
| 17 | `pro_payout_paid_v1` | `PRO_PAYOUT_PAID` | 1 | | |
| 18 | `pro_payout_on_hold_v1` | `PRO_PAYOUT_ON_HOLD` | 1 | | |
| 19 | `pro_payout_released_v1` | `PRO_PAYOUT_RELEASED` | 1 | | |
