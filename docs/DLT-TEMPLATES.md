# DLT SMS templates: registration guide

> Generated from `apps/api/src/modules/notifications/templates/templates.ts` (with `variables.ts`
> and the OTP SMS adapter in `apps/api/src/modules/auth/sms/`). Regenerate this file whenever a
> template's `version` changes. Generated 5 Nov 2026. Each block gives the template's version.

India's TRAI DLT system blocks any SMS whose text does not match a registered template. Clickco
sends 21 SMS templates through MSG91: the login OTP, the account-deletion OTP and 19 lifecycle
messages. `PRO_NEW_OFFER` is push only, so it is not registered. The WhatsApp side is in
`docs/WHATSAPP-TEMPLATES.md`.

## Settle these first

1. **The login OTP text is not in the code.** Template 1 below is a proposal. Approve or reword it
   before you register.
2. **`DELIVERED` carries a link, so it uses a URL variable, `{#url#}`.** Whitelist the domain
   before you submit it. See "The delivery link" below.

## Steps

### 1. Register as a Principal Entity

1. Pick one DLT portal. One registration covers every operator.
   - Jio: https://trueconnect.jio.com
   - Airtel: https://dltconnect.airtel.in
   - Vi: https://www.vilpower.in
2. Sign up as a **Principal Entity** (the business that sends), not as a telemarketer.
3. Upload the company papers it asks for: PAN, GST certificate, proof of incorporation and a letter
   naming the authorised person.
4. Wait for approval. You get an **Entity ID** (digits, usually 19). That is `MSG91_DLT_ENTITY_ID`.
5. Add MSG91 as your telemarketer on the portal. TRAI blocks messages whose chain from you to the
   sender is not declared. MSG91's help pages, or its support, give the id to add.

### 2. Register the header (sender id)

1. On the portal, open Headers and add one.
2. Choose the **transactional / service** type. Promotional headers are numeric and cannot send
   these messages.
3. Use 6 capital letters close to the brand, for example `CLCKCO`. The API accepts exactly 6
   capital letters.
4. Wait for approval. The header is `MSG91_SENDER_ID`.

### 3. Register each content template

1. On the portal, open Content Templates and add one per block below.
2. Type: **Service Implicit**, for all 21.
3. Header: the one from step 2.
4. Template name: the suggested name in the block.
5. Content: paste the "DLT text" from the block. Do not retype it.
6. For `DELIVERED`, whitelist the link's domain first (see "The delivery link").
7. Wait for approval. Each approved template gets a **DLT template id** (digits, usually 19).
   Write it in the fill-in table at the end.

### 4. Create one MSG91 template (flow) per DLT template

1. In MSG91, finish the account KYC. Add your DLT Entity ID and your header (Sender ID).
2. Open SMS, then Templates (older accounts call it Flow). Create one per approved DLT template.
3. Paste the block's "MSG91 template text". It is the DLT text with each `{#var#}` written as
   `##name##`. Keep the names exactly as shown, same case. The API sends the values by these names.
4. Enter the template's DLT template id. Pick your header as the sender. The API sends
   `MSG91_SENDER_ID` with every message anyway.
5. Save. Copy MSG91's id for the template (the flow id, 8 to 40 letters and digits). Write it in the
   fill-in table.
6. Do not turn on MSG91's link shortener. The API turns it off and sends the link exactly as
   registered.

### 5. Hand over the values

| Value | Where it comes from | Where it goes |
|---|---|---|
| `MSG91_DLT_ENTITY_ID` | DLT portal, step 1 | Paste to Claude |
| `MSG91_SENDER_ID` | DLT portal, step 2 | Paste to Claude |
| `MSG91_TEMPLATES` | The fill-in table at the end | Paste the filled table to Claude |
| `MSG91_OTP_FLOW_ID`, `MSG91_OTP_DLT_TEMPLATE_ID` | MSG91 and DLT, template 1 | Paste to Claude |
| `MSG91_DELETE_OTP_FLOW_ID`, `MSG91_DELETE_OTP_DLT_TEMPLATE_ID` | MSG91 and DLT, template 2 | Paste to Claude |
| `MSG91_AUTH_KEY` | MSG91, API settings (the auth key) | **Doppler only.** Never in chat, a file or git. |

For `MSG91_AUTH_KEY`: open the Doppler dashboard, project `clickco-api`, config `prd` (and your
staging config, if you run one), and add the secret there.

The ids are not secrets. The API checks their shape at boot, and refuses to start with
`NOTIFY_SMS_ADAPTER=msg91` until all 19 lifecycle templates are in `MSG91_TEMPLATES`.

## DLT rules

- **Fixed text must match exactly**, character for character: capitals, full stops, colons, the
  en dash in `REFUND_ISSUED`. Copy it from the blocks.
- **One variable per value**, in the order shown. Each block lists our placeholder beside it.
- **A `{#var#}` holds at most 30 characters.** Every value fits except the delivery link, which
  goes in a `{#url#}`.
- **Links must be whitelisted.** TRAI blocks an SMS that carries a URL not whitelisted on the
  portal (the URL or CTA whitelisting section). Only `DELIVERED` has one.
- **Category: Service Implicit for all 21.** Each is about the person's own sign-in, booking,
  payment, request, job or payout. templates.ts marks every lifecycle template `transactional` or
  `utility` and says none is marketing, so none is Service Explicit or Promotional. Do not pick
  "Transactional": on DLT that type is for banks.
- **`₹` and `–` are not plain SMS characters.** A message with them goes as Unicode: 70 characters
  for one part, 67 for each part after. That costs more parts. It is not a rejection. If MSG91 or
  the portal asks whether a template is Unicode, say yes for the ones whose sample says Unicode.

### The delivery link

`DELIVERED` sends `{link}` as one value: `<PUBLIC_WEB_URL>/d/<token>`. The token alone is 43
characters (an HMAC-SHA256, base64url), and the whole link is 76 characters on
`https://clickco-web.vercel.app` and 64 on `https://clickco.in`. A plain `{#var#}` holds 30, so
the link cannot go in one.

1. **Use the URL variable.** Register the template with `{#url#}` where the link goes:
   `Your photos for {#var#} are ready: {#url#}`. `{#url#}` is the DLT variable type for links.
   MSG91 fills variables by position, so its text stays
   `Your photos for ##bookingRef## are ready: ##link##`.
2. **Whitelist the domain** on the portal, in the URL or CTA whitelisting section, before you
   submit the template: `https://clickco-web.vercel.app` now. Before the site moves, whitelist
   `https://clickco.in` too (and `https://www.clickco.in` if the site uses `www.`). The SMS link
   follows `PUBLIC_WEB_URL`, so whitelist a domain before `PUBLIC_WEB_URL` points to it. The
   template text does not change when the domain does.
3. **Check the `{#url#}` limit** on your portal covers 76 characters. If it does not, tell Claude
   before you submit: the link would then need a code change.

## Templates

### 1. Login OTP (sign-in code)

- **Template code and version:** none in templates.ts. This is the OTP SMS for sign-in, used by
  the client app and Clickco Pro alike (OTP purposes `LOGIN` and `PRO_LOGIN`,
  `msg91-otp-sms.adapter.ts`). Suggested DLT template name: `LOGIN_OTP_V1`. Env:
  `MSG91_OTP_FLOW_ID` and `MSG91_OTP_DLT_TEMPLATE_ID`.
- **DLT category:** Service Implicit. A one-time code the person asked for. It sells nothing.
- **The wording is not in the code. This text is a proposal.** The code needs only one variable,
  `otp`. The text mirrors the deletion code's wording (template 2). It names only Clickco, because
  Pro sign-ins use it too. The code expires after 5 minutes (`otp.service.ts`). You may add "It
  expires in 5 minutes.", but then the text must change if the expiry does.

DLT text (proposed; paste exactly once approved):

```text
{#var#} is your Clickco sign-in code. Do not share it.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `otp` | 6 digits (`OtpService`; the adapter refuses anything but 4 to 8 digits) | 6 |

Sample message (53 characters, plain text, 1 SMS part):

```text
482913 is your Clickco sign-in code. Do not share it.
```

MSG91 template text. Flow variable: `otp`.

```text
##otp## is your Clickco sign-in code. Do not share it.
```

### 2. Account-deletion OTP

- **Template code and version:** none in templates.ts. The code sent before an account is
  deleted (OTP purpose `ACCOUNT_DELETE`, ADR-0030). Suggested DLT template name:
  `ACCOUNT_DELETE_OTP_V1`. Env: `MSG91_DELETE_OTP_FLOW_ID` and `MSG91_DELETE_OTP_DLT_TEMPLATE_ID`.
- **DLT category:** Service Implicit. A one-time code the person asked for. It sells nothing.
- **Wording:** from ADR-0030 and DEPLOY.md, where it is given as an example. It must never read as
  a sign-in code (ADR-0030), so it gets its own template.

DLT text (paste exactly):

```text
{#var#} is your Clickco code to DELETE your account. Do not share it.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `otp` | 6 digits (`OtpService`; the adapter refuses anything but 4 to 8 digits) | 6 |

Sample message (68 characters, plain text, 1 SMS part):

```text
482913 is your Clickco code to DELETE your account. Do not share it.
```

MSG91 template text. Flow variable: `otp`.

```text
##otp## is your Clickco code to DELETE your account. Do not share it.
```

### 3. BOOKING_CONFIRMED (v1)

- **Template code and version:** `BOOKING_CONFIRMED`, version 1. Suggested DLT template name: `BOOKING_CONFIRMED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
Your Clickco booking {#var#} for {#var#} is confirmed. We will share your photographer once one is assigned.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{when}` | IST day, date and time, e.g. `Sat 14 Nov, 4:30 pm` | 20 |

Sample message (123 characters, plain text, 1 SMS part):

```text
Your Clickco booking CLK-104237 for Sat 14 Nov, 4:30 pm is confirmed. We will share your photographer once one is assigned.
```

MSG91 template text. Flow variables: `bookingRef`, `when`.

```text
Your Clickco booking ##bookingRef## for ##when## is confirmed. We will share your photographer once one is assigned.
```

### 4. PHOTOGRAPHER_ASSIGNED (v2)

- **Template code and version:** `PHOTOGRAPHER_ASSIGNED`, version 2. Suggested DLT template name: `PHOTOGRAPHER_ASSIGNED_V2`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.
- **Version 2.** Register this wording. Version 1 is retired; if you registered it already, leave it unused.
- **Has a phone number** (`{callNumber}`, the ExoPhone). If your portal asks for call-back numbers to be whitelisted (CTA), add the ExoPhone there. If it offers a call-back-number variable type (`{#cbn#}`), you may use it for variable 4; MSG91's text stays the same.

DLT text (paste exactly):

```text
Your photographer {#var#} will shoot your booking {#var#} on {#var#}. Call them from the Clickco app: calls show {#var#} and your number stays private.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{photographerName}` | first name: letters, `.`, `'` and `-` | 30 |
| 2 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 3 | `{when}` | IST day, date and time, e.g. `Sat 14 Nov, 4:30 pm` | 20 |
| 4 | `{callNumber}` | Clickco's virtual (ExoPhone) number: optional `+`, 8 to 15 digits | 16 |

Sample message (170 characters, plain text, 2 SMS parts):

```text
Your photographer Priya will shoot your booking CLK-104237 on Sat 14 Nov, 4:30 pm. Call them from the Clickco app: calls show +918041234567 and your number stays private.
```

MSG91 template text. Flow variables: `photographerName`, `bookingRef`, `when`, `callNumber`.

```text
Your photographer ##photographerName## will shoot your booking ##bookingRef## on ##when##. Call them from the Clickco app: calls show ##callNumber## and your number stays private.
```

### 5. PHOTOGRAPHER_ON_THE_WAY (v2)

- **Template code and version:** `PHOTOGRAPHER_ON_THE_WAY`, version 2. Suggested DLT template name: `PHOTOGRAPHER_ON_THE_WAY_V2`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.
- **Version 2.** Register this wording. Version 1 is retired; if you registered it already, leave it unused.

DLT text (paste exactly):

```text
Your photographer {#var#} is on the way to your Clickco shoot {#var#}.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{photographerName}` | first name: letters, `.`, `'` and `-` | 30 |
| 2 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |

Sample message (71 characters, plain text, 1 SMS part):

```text
Your photographer Priya is on the way to your Clickco shoot CLK-104237.
```

MSG91 template text. Flow variables: `photographerName`, `bookingRef`.

```text
Your photographer ##photographerName## is on the way to your Clickco shoot ##bookingRef##.
```

### 6. CHECKED_IN (v2)

- **Template code and version:** `CHECKED_IN`, version 2. Suggested DLT template name: `CHECKED_IN_V2`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.
- **Version 2.** Register this wording. Version 1 is retired; if you registered it already, leave it unused.

DLT text (paste exactly):

```text
Your photographer {#var#} has arrived for your Clickco shoot {#var#}.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{photographerName}` | first name: letters, `.`, `'` and `-` | 30 |
| 2 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |

Sample message (70 characters, plain text, 1 SMS part):

```text
Your photographer Priya has arrived for your Clickco shoot CLK-104237.
```

MSG91 template text. Flow variables: `photographerName`, `bookingRef`.

```text
Your photographer ##photographerName## has arrived for your Clickco shoot ##bookingRef##.
```

### 7. EXTENSION_REQUESTED (v1)

- **Template code and version:** `EXTENSION_REQUESTED`, version 1. Suggested DLT template name: `EXTENSION_REQUESTED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
Your photographer asked to extend shoot {#var#} by {#var#} minutes for {#var#}. Approve or decline in the Clickco app within 10 minutes.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{minutes}` | whole minutes, 1 to 999 | 3 |
| 3 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |

Sample message (131 characters, Unicode because of `₹`, 2 SMS parts):

```text
Your photographer asked to extend shoot CLK-104237 by 30 minutes for ₹750. Approve or decline in the Clickco app within 10 minutes.
```

MSG91 template text. Flow variables: `bookingRef`, `minutes`, `amount`.

```text
Your photographer asked to extend shoot ##bookingRef## by ##minutes## minutes for ##amount##. Approve or decline in the Clickco app within 10 minutes.
```

### 8. CHECKED_OUT (v1)

- **Template code and version:** `CHECKED_OUT`, version 1. Suggested DLT template name: `CHECKED_OUT_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
Your Clickco shoot {#var#} is complete. We will message you as soon as your photos are ready.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |

Sample message (96 characters, plain text, 1 SMS part):

```text
Your Clickco shoot CLK-104237 is complete. We will message you as soon as your photos are ready.
```

MSG91 template text. Flow variables: `bookingRef`.

```text
Your Clickco shoot ##bookingRef## is complete. We will message you as soon as your photos are ready.
```

### 9. BALANCE_DUE (v1)

- **Template code and version:** `BALANCE_DUE`, version 1. Suggested DLT template name: `BALANCE_DUE_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
Your photos for {#var#} have passed our quality check. Pay the balance of {#var#} in the Clickco app to receive them.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |

Sample message (122 characters, Unicode because of `₹`, 2 SMS parts):

```text
Your photos for CLK-104237 have passed our quality check. Pay the balance of ₹5,767.25 in the Clickco app to receive them.
```

MSG91 template text. Flow variables: `bookingRef`, `amount`.

```text
Your photos for ##bookingRef## have passed our quality check. Pay the balance of ##amount## in the Clickco app to receive them.
```

### 10. BALANCE_REMINDER (v1)

- **Template code and version:** `BALANCE_REMINDER`, version 1. Suggested DLT template name: `BALANCE_REMINDER_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `utility`: a reminder about the client's own unpaid booking (held in quiet hours, can be muted). It sells nothing, so it is not Service Explicit or Promotional.

DLT text (paste exactly):

```text
Reminder: your photos for {#var#} are waiting. Pay the balance of {#var#} in the Clickco app to receive them.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |

Sample message (114 characters, Unicode because of `₹`, 2 SMS parts):

```text
Reminder: your photos for CLK-104237 are waiting. Pay the balance of ₹5,767.25 in the Clickco app to receive them.
```

MSG91 template text. Flow variables: `bookingRef`, `amount`.

```text
Reminder: your photos for ##bookingRef## are waiting. Pay the balance of ##amount## in the Clickco app to receive them.
```

### 11. DELIVERED (v1)

- **Template code and version:** `DELIVERED`, version 1. Suggested DLT template name: `DELIVERED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.
- **Has a link: variable 2 is `{#url#}`, not `{#var#}`.** Whitelist the domain first. Read "The delivery link" (in "DLT rules").
- **No "Clickco" in the fixed text.** The header already names the sender, so this usually passes. If the portal rejects it for that reason, tell Claude: adding the name is a code change and a new version.

DLT text (paste exactly):

```text
Your photos for {#var#} are ready: {#url#}
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{link}` | the full delivery link `<PUBLIC_WEB_URL>/d/<43-character token>`. URL-type variable `{#url#}` | 76 now, 64 on clickco.in (too long for `{#var#}`) |

Sample message (114 characters, plain text, 1 SMS part):

```text
Your photos for CLK-104237 are ready: https://clickco-web.vercel.app/d/q7Lw2mZx9VbR4tKp0sYcN8eHjD3fUa6gT1oQiE5rXnM
```

MSG91 template text. Flow variables: `bookingRef`, `link`.

```text
Your photos for ##bookingRef## are ready: ##link##
```

### 12. REFUND_ISSUED (v2)

- **Template code and version:** `REFUND_ISSUED`, version 2. Suggested DLT template name: `REFUND_ISSUED_V2`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.
- **Version 2.** Register this wording. Version 1 is retired; if you registered it already, leave it unused.
- **No "Clickco" in the fixed text.** The header already names the sender, so this usually passes. If the portal rejects it for that reason, tell Claude: adding the name is a code change and a new version.
- **Watch the dash.** `7–10` uses an en dash (–), not a hyphen. Copy it from here; do not retype it.

DLT text (paste exactly):

```text
A refund of {#var#} for booking {#var#} has been processed. It can take 7–10 working days to reach your account.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |
| 2 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |

Sample message (114 characters, Unicode because of `₹` and `–`, 2 SMS parts):

```text
A refund of ₹2,000 for booking CLK-104237 has been processed. It can take 7–10 working days to reach your account.
```

MSG91 template text. Flow variables: `amount`, `bookingRef`.

```text
A refund of ##amount## for booking ##bookingRef## has been processed. It can take 7–10 working days to reach your account.
```

### 13. BOOKING_CANCELLED (v1)

- **Template code and version:** `BOOKING_CANCELLED`, version 1. Suggested DLT template name: `BOOKING_CANCELLED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
Your Clickco booking {#var#} for {#var#} has been cancelled as you asked. Any refund due is on its way to your original payment method, and we will message you when it is processed.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{when}` | IST day, date and time, e.g. `Sat 14 Nov, 4:30 pm` | 20 |

Sample message (196 characters, plain text, 2 SMS parts):

```text
Your Clickco booking CLK-104237 for Sat 14 Nov, 4:30 pm has been cancelled as you asked. Any refund due is on its way to your original payment method, and we will message you when it is processed.
```

MSG91 template text. Flow variables: `bookingRef`, `when`.

```text
Your Clickco booking ##bookingRef## for ##when## has been cancelled as you asked. Any refund due is on its way to your original payment method, and we will message you when it is processed.
```

### 14. DATA_LOSS_CLIENT (v1)

- **Template code and version:** `DATA_LOSS_CLIENT`, version 1. Suggested DLT template name: `DATA_LOSS_CLIENT_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
We are sorry: the photos from your Clickco shoot {#var#} could not be recovered. A refund of {#var#} is on its way to your original payment method, and we will message you when it is processed.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |
| 2 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |

Sample message (195 characters, Unicode because of `₹`, 3 SMS parts):

```text
We are sorry: the photos from your Clickco shoot CLK-104237 could not be recovered. A refund of ₹8,500 is on its way to your original payment method, and we will message you when it is processed.
```

MSG91 template text. Flow variables: `bookingRef`, `amount`.

```text
We are sorry: the photos from your Clickco shoot ##bookingRef## could not be recovered. A refund of ##amount## is on its way to your original payment method, and we will message you when it is processed.
```

### 15. PARTIAL_DATA_LOSS_CLIENT (v1)

- **Template code and version:** `PARTIAL_DATA_LOSS_CLIENT`, version 1. Suggested DLT template name: `PARTIAL_DATA_LOSS_CLIENT_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
We are sorry: some of the photos from your Clickco shoot {#var#} could not be recovered. You will get a refund for the part that was lost, and the rest of your photos will be delivered as usual.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{bookingRef}` | `CLK-` and 4 to 10 digits | 14 |

Sample message (197 characters, plain text, 2 SMS parts):

```text
We are sorry: some of the photos from your Clickco shoot CLK-104237 could not be recovered. You will get a refund for the part that was lost, and the rest of your photos will be delivered as usual.
```

MSG91 template text. Flow variables: `bookingRef`.

```text
We are sorry: some of the photos from your Clickco shoot ##bookingRef## could not be recovered. You will get a refund for the part that was lost, and the rest of your photos will be delivered as usual.
```

### 16. CREDIT_ISSUED (v1)

- **Template code and version:** `CREDIT_ISSUED`, version 1. Suggested DLT template name: `CREDIT_ISSUED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
You have {#var#} of Clickco credit, valid until {#var#}. It is applied at your next booking.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |
| 2 | `{expiresOn}` | IST date, e.g. `5 Nov 2027` | 11 |

Sample message (92 characters, Unicode because of `₹`, 2 SMS parts):

```text
You have ₹500 of Clickco credit, valid until 5 Nov 2027. It is applied at your next booking.
```

MSG91 template text. Flow variables: `amount`, `expiresOn`.

```text
You have ##amount## of Clickco credit, valid until ##expiresOn##. It is applied at your next booking.
```

### 17. TICKET_RECEIVED (v1)

- **Template code and version:** `TICKET_RECEIVED`, version 1. Suggested DLT template name: `TICKET_RECEIVED_V1`.
- **Goes to:** the client.
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the client about their own booking, payment or request. It sells nothing.

DLT text (paste exactly):

```text
We have received your Clickco support request {#var#}. Our team will reply by {#var#}. You can follow it in the Clickco app.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{ticketRef}` | `TKT-` and 4 to 10 digits | 14 |
| 2 | `{replyBy}` | IST day, date and time, e.g. `Fri 6 Nov, 11:00 am` | 20 |

Sample message (137 characters, plain text, 1 SMS part):

```text
We have received your Clickco support request TKT-1043. Our team will reply by Fri 6 Nov, 11:00 am. You can follow it in the Clickco app.
```

MSG91 template text. Flow variables: `ticketRef`, `replyBy`.

```text
We have received your Clickco support request ##ticketRef##. Our team will reply by ##replyBy##. You can follow it in the Clickco app.
```

### 18. PRO_JOB_CANCELLED (v1)

- **Template code and version:** `PRO_JOB_CANCELLED`, version 1. Suggested DLT template name: `PRO_JOB_CANCELLED_V1`.
- **Goes to:** the photographer (Clickco Pro).
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the photographer about their own job or payout. It sells nothing.

DLT text (paste exactly):

```text
The client cancelled your Clickco job on {#var#}. It is off your schedule, and any payout owed for it will show in Earnings in Clickco Pro.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{when}` | IST day, date and time, e.g. `Sat 14 Nov, 4:30 pm` | 20 |

Sample message (152 characters, plain text, 1 SMS part):

```text
The client cancelled your Clickco job on Sun 15 Nov, 10:00 am. It is off your schedule, and any payout owed for it will show in Earnings in Clickco Pro.
```

MSG91 template text. Flow variables: `when`.

```text
The client cancelled your Clickco job on ##when##. It is off your schedule, and any payout owed for it will show in Earnings in Clickco Pro.
```

### 19. PRO_PAYOUT_PAID (v1)

- **Template code and version:** `PRO_PAYOUT_PAID`, version 1. Suggested DLT template name: `PRO_PAYOUT_PAID_V1`.
- **Goes to:** the photographer (Clickco Pro).
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the photographer about their own job or payout. It sells nothing.

DLT text (paste exactly):

```text
Clickco has paid you {#var#} (bank reference ending {#var#}). See Earnings in Clickco Pro for details.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |
| 2 | `{utrLast4}` | last 4 letters or digits of the bank UTR | 4 |

Sample message (99 characters, Unicode because of `₹`, 2 SMS parts):

```text
Clickco has paid you ₹12,450 (bank reference ending 4821). See Earnings in Clickco Pro for details.
```

MSG91 template text. Flow variables: `amount`, `utrLast4`.

```text
Clickco has paid you ##amount## (bank reference ending ##utrLast4##). See Earnings in Clickco Pro for details.
```

### 20. PRO_PAYOUT_ON_HOLD (v1)

- **Template code and version:** `PRO_PAYOUT_ON_HOLD`, version 1. Suggested DLT template name: `PRO_PAYOUT_ON_HOLD_V1`.
- **Goes to:** the photographer (Clickco Pro).
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the photographer about their own job or payout. It sells nothing.

DLT text (paste exactly):

```text
Your Clickco payout of {#var#} for the shoot on {#var#} is on hold while our team reviews it. We will message you when it is released.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |
| 2 | `{shootDate}` | IST date, e.g. `31 Oct 2026` | 11 |

Sample message (137 characters, Unicode because of `₹`, 3 SMS parts):

```text
Your Clickco payout of ₹3,200 for the shoot on 31 Oct 2026 is on hold while our team reviews it. We will message you when it is released.
```

MSG91 template text. Flow variables: `amount`, `shootDate`.

```text
Your Clickco payout of ##amount## for the shoot on ##shootDate## is on hold while our team reviews it. We will message you when it is released.
```

### 21. PRO_PAYOUT_RELEASED (v1)

- **Template code and version:** `PRO_PAYOUT_RELEASED`, version 1. Suggested DLT template name: `PRO_PAYOUT_RELEASED_V1`.
- **Goes to:** the photographer (Clickco Pro).
- **DLT category:** Service Implicit. templates.ts marks it `transactional`: it tells the photographer about their own job or payout. It sells nothing.

DLT text (paste exactly):

```text
Your Clickco payout of {#var#} for the shoot on {#var#} has been released. It will be paid in an upcoming weekly payout.
```

| # | Our placeholder | Format | Max length |
|---|---|---|---|
| 1 | `{amount}` | rupees: `₹`, Indian commas, paise only when not whole, e.g. `₹5,767.25` | no cap in the pattern; 13 up to `₹99,99,999.99` |
| 2 | `{shootDate}` | IST date, e.g. `31 Oct 2026` | 11 |

Sample message (123 characters, Unicode because of `₹`, 2 SMS parts):

```text
Your Clickco payout of ₹3,200 for the shoot on 31 Oct 2026 has been released. It will be paid in an upcoming weekly payout.
```

MSG91 template text. Flow variables: `amount`, `shootDate`.

```text
Your Clickco payout of ##amount## for the shoot on ##shootDate## has been released. It will be paid in an upcoming weekly payout.
```

## Fill-in: what to paste to Claude

### Lifecycle templates (`MSG91_TEMPLATES`)

Fill one row per template as each is approved. Leave a row empty until both ids exist.

| Template code | MSG91 flow id | DLT template id |
|---|---|---|
| `BOOKING_CONFIRMED` | | |
| `PHOTOGRAPHER_ASSIGNED` | | |
| `PHOTOGRAPHER_ON_THE_WAY` | | |
| `CHECKED_IN` | | |
| `EXTENSION_REQUESTED` | | |
| `CHECKED_OUT` | | |
| `BALANCE_DUE` | | |
| `BALANCE_REMINDER` | | |
| `DELIVERED` | | |
| `REFUND_ISSUED` | | |
| `BOOKING_CANCELLED` | | |
| `DATA_LOSS_CLIENT` | | |
| `PARTIAL_DATA_LOSS_CLIENT` | | |
| `CREDIT_ISSUED` | | |
| `TICKET_RECEIVED` | | |
| `PRO_JOB_CANCELLED` | | |
| `PRO_PAYOUT_PAID` | | |
| `PRO_PAYOUT_ON_HOLD` | | |
| `PRO_PAYOUT_RELEASED` | | |

The resulting `MSG91_TEMPLATES` value. Every one of the 19 codes must be present, and no other code,
or the API refuses to boot. A flow id is 8 to 40 letters and digits; a DLT template id is 10 to 25
digits. Claude fills this from the table above.

```json
{
  "BOOKING_CONFIRMED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PHOTOGRAPHER_ASSIGNED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PHOTOGRAPHER_ON_THE_WAY": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "CHECKED_IN": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "EXTENSION_REQUESTED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "CHECKED_OUT": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "BALANCE_DUE": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "BALANCE_REMINDER": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "DELIVERED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "REFUND_ISSUED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "BOOKING_CANCELLED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "DATA_LOSS_CLIENT": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PARTIAL_DATA_LOSS_CLIENT": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "CREDIT_ISSUED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "TICKET_RECEIVED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PRO_JOB_CANCELLED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PRO_PAYOUT_PAID": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PRO_PAYOUT_ON_HOLD": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" },
  "PRO_PAYOUT_RELEASED": { "flowId": "<flow id>", "dltTemplateId": "<DLT template id>" }
}
```

### OTP and account values

| Env variable | Value |
|---|---|
| `MSG91_OTP_FLOW_ID` | |
| `MSG91_OTP_DLT_TEMPLATE_ID` | |
| `MSG91_DELETE_OTP_FLOW_ID` | |
| `MSG91_DELETE_OTP_DLT_TEMPLATE_ID` | |
| `MSG91_SENDER_ID` | |
| `MSG91_DLT_ENTITY_ID` | |

`MSG91_AUTH_KEY` is not in this table on purpose. It goes into Doppler only (step 5).
