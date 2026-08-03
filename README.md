# Solana treasury with auto-burn on API error

Creates an SPL token where your treasury wallet keeps mint authority,
then burns tokens from that treasury whenever a wired-up call (e.g. the
ChatGPT API) errors out.

## 1. Install dependencies
```
npm install
```

## 2. Generate a treasury keypair
Using the Solana CLI (recommended):
```
solana-keygen new --outfile treasury-keypair.json
```
This is your treasury's private key. **Never commit this file or share it.**
Add `treasury-keypair.json` to `.gitignore` before you do anything else.

## 3. Fund the treasury (devnet first)
```
solana airdrop 2 <TREASURY_PUBLIC_KEY> --url devnet
```

## 4. Create the token
```
npm run create-token
```
This creates the mint, an associated token account for the treasury,
mints the initial supply, and writes `token-config.json` with the
addresses you'll need everywhere else.

## 5. Wire up the burn
`burn-on-error.js` exports `burnFromTreasury(amount)`. Call it from
wherever your ChatGPT API error handling already lives — the file
includes a working example (`callChatGPTWithBurnOnError`) you can
copy or adapt.

Set your OpenAI key as an env var before running anything that uses it:
```
export OPENAI_API_KEY=sk-...
```

## 6. Going to mainnet
When you're ready for real funds:
- Change `CLUSTER` from `"devnet"` to `"mainnet-beta"` in **both** scripts
- Fund the treasury with real SOL (not an airdrop)
- Re-run `create-token.js` to deploy the live mint — this is a new,
  separate token from your devnet one

## Notes
- Every burn costs a normal Solana transaction fee (~0.000005 SOL) —
  no rent, no extra charge.
- The treasury wallet must sign every burn transaction. That's this
  script running with access to `treasury-keypair.json` — keep that
  file, and the machine it runs on, secured accordingly.
- If you'd rather not keep mint authority with a hot wallet long-term,
  look into a Solana program (Anchor) that holds authority via a PDA
  instead — happy to help scaffold that if you want tighter control
  later.
