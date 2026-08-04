import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { burnChecked, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";

const CLUSTER = "mainnet-beta"; // must match create-token.js

export const { mint, treasuryAta, decimals } = JSON.parse(
  fs.readFileSync("./token-config.json", "utf8")
);

const secretKey = Uint8Array.from(
  JSON.parse(fs.readFileSync("./treasury-keypair.json", "utf8"))
);
const treasury = Keypair.fromSecretKey(secretKey);

const connection = new Connection(clusterApiUrl(CLUSTER), "confirmed");

/**
 * Burns `amount` whole tokens from the treasury's own token account.
 * Call this from wherever your ChatGPT API error handling lives.
 */
export async function burnFromTreasury(amount) {
  const rawAmount = BigInt(amount) * 10n ** BigInt(decimals);

  const signature = await burnChecked(
    connection,
    treasury,                     // fee payer
    new PublicKey(treasuryAta),   // account holding the tokens
    new PublicKey(mint),
    treasury,                     // owner of the token account, signs the burn
    rawAmount,
    decimals,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  console.log(`Burned ${amount} tokens. Signature: ${signature}`);
  return signature;
}

/**
 * Burns a raw base-unit amount (already scaled by `decimals`) from the
 * treasury's own token account. Use this when the amount was computed with
 * fixed-point integer math elsewhere — e.g. the tiered weekly burn, where
 * per-second rates produce fractional token amounts that `burnFromTreasury`
 * above can't accept (it only takes whole-token integers).
 */
export async function burnRawFromTreasury(rawAmount) {
  const signature = await burnChecked(
    connection,
    treasury,                     // fee payer
    new PublicKey(treasuryAta),   // account holding the tokens
    new PublicKey(mint),
    treasury,                     // owner of the token account, signs the burn
    rawAmount,                    // must already be a BigInt in base units
    decimals,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  console.log(`Burned ${rawAmount} raw base units. Signature: ${signature}`);
  return signature;
}

// --- Example: wiring this into a ChatGPT API call ---
export async function callChatGPTWithBurnOnError(payload, burnAmount = 1) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`ChatGPT API error: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("ChatGPT call failed, burning treasury tokens:", err.message);
    await burnFromTreasury(burnAmount); // adjust burn amount to your rules
    throw err; // still surface the original error to your caller
  }
}
