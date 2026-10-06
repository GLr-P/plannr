# Plannr sync service

A small Cloudflare Worker that lets your Plannr devices (PCs and phone) sync. It only ever stores
encrypted data: every change and file is sealed on your device with a key the service never sees.
It also serves the phone web app.

Runs on Cloudflare's free plan (Workers + D1). You need a free Cloudflare account.

## Deploy

From the project folder:

```sh
npm run build:web                                   # the phone web app (out/web)
cd server
npx wrangler login                                  # opens the browser once
npx wrangler d1 create plannr-sync                  # prints a database_id
cp wrangler.example.toml wrangler.toml              # then paste the database_id into wrangler.toml
npx wrangler secret put OWNER_SECRET                # choose a long setup code; Plannr asks for it once
npx wrangler deploy                                 # prints your address, e.g. https://plannr-sync.<you>.workers.dev
```

Then in Plannr on your PC: Settings → Sync & devices → Start syncing from this PC, and enter the
address and setup code. Add your phone with the QR code shown there.

The setup code is only needed to create a sync space, so strangers can't use your service.
To update the service later, run `npx wrangler deploy` again.

## What the service can see

Which device sent a change and when, how many rows each kind of item has (the table names are not
encrypted), and the sizes of files. Not the contents of anything.
