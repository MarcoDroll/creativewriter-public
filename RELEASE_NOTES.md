# Release Notes

> **Fix Stripe portal verification failing after return from billing portal**

## 📋 Release Information
- **Commits**: 1 commit since last release
- **Key Areas**: Stripe Premium Portal, Subscription Verification

## 🔧 Bug Fixes

### Stripe Portal Verification
- 🐛 **Fixed 401 errors after Stripe portal return** - Users returning from the Stripe billing portal (login_page OTP flow) were seeing repeated "Verifying with Stripe..." failures. The verification KV entries are now written synchronously in the portal return handler instead of relying on a webhook that could fire late or not at all
- ⚡ **Faster verification polling** - Reduced verification polling from 10 attempts over ~30 seconds to 6 attempts over ~11 seconds, since verification is now available immediately on return
- 🎯 **No more false polling on page refresh** - The app now only polls for claim-verification when genuinely returning from the Stripe portal (detected via `portal_return=1` parameter), preventing unnecessary 401 errors on normal page loads with `?tab=premium`

## 🏗️ Technical Improvements
- **Synchronous KV writes**: The `/api/portal/return` handler now writes `portal_verified` entries to KV before redirecting the user, eliminating webhook timing and KV eventual-consistency issues
- **Cookie payload enriched**: The portal redirect cookie now carries `email` and `customerId` alongside `returnUrl` (JSON format with backward compatibility for old plain-URL cookies)
- **Webhook retained as backup**: The `billing_portal.session.created` webhook handler is unchanged and serves as a redundant fallback

---
*Release prepared with [Claude Code](https://claude.com/claude-code)*
