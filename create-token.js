import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";

// --- Config ---
const CLUSTER = "mainnet-beta"; // LIVE — this uses real SOL and creates a real, permanent token
const DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000n; // whole tokens, before decimals are applied

// How the total supply gets split up when it's created.
// These should add up to 1.0 (100%). Change the numbers, not the names.
const SPLIT = {
  founder: 0.20,  // goes straight to your own wallet
  treasury: 0.30, // stays in the treasury — this is the part that burns over time
  traders: 0.50,  // set aside for liquidity / other traders later
};

function loadKeypair(path) {
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secretKey);
}

async function main() {
  const connection = new Connection(clusterApiUrl(CLUSTER), "confirmed");

  // Only the treasury needs SOL — it pays every fee in this script.
  const treasury = loadKeypair("./treasury-keypair.json");
  const founder = loadKeypair("./founder-keypair.json");
  const traders = loadKeypair("./traders-keypair.json");

  console.log("Treasury wallet:", treasury.publicKey.toBase58());
  console.log("Founder wallet:", founder.publicKey.toBase58());
  console.log("Traders wallet:", traders.publicKey.toBase58());

  // Create the mint. Treasury keeps mint + freeze authority.
  const mint = await createMint(
    connection,
    treasury,
    treasury.publicKey,
    treasury.publicKey,
    DECIMALS,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log("Mint address:", mint.toBase58());

  // Make a token account for each wallet (treasury pays for all three)
  const treasuryAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, treasury.publicKey);
  const founderAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, founder.publicKey);
  const tradersAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, traders.publicKey);

  // Work out how many tokens go where
  const rawTotal = TOTAL_SUPPLY * 10n ** BigInt(DECIMALS);
  const toRaw = (pct) => (rawTotal * BigInt(Math.round(pct * 10000))) / 10000n;

  const treasuryAmount = toRaw(SPLIT.treasury);
  const founderAmount = toRaw(SPLIT.founder);
  const tradersAmount = toRaw(SPLIT.traders);

  await mintTo(connection, treasury, mint, treasuryAta.address, treasury, treasuryAmount);
  await mintTo(connection, treasury, mint, founderAta.address, treasury, founderAmount);
  await mintTo(connection, treasury, mint, tradersAta.address, treasury, tradersAmount);

  console.log(`Minted ${SPLIT.treasury * 100}% to treasury`);
  console.log(`Minted ${SPLIT.founder * 100}% to founder`);
  console.log(`Minted ${SPLIT.traders * 100}% to traders`);

  fs.writeFileSync(
    "./token-config.json",
    JSON.stringify(
      {
        mint: mint.toBase58(),
        treasuryAta: treasuryAta.address.toBase58(),
        founderAta: founderAta.address.toBase58(),
        tradersAta: tradersAta.address.toBase58(),
        decimals: DECIMALS,
      },
      null,
      2
    )
  );
  console.log("Saved mint + account details to token-config.json");
}

main().catch((err) => {
  console.error("Token creation failed:", err);
  process.exit(1);
});
