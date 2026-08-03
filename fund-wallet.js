import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";

// Paste the public address that generate-keypair.js printed for you
const TREASURY_PUBLIC_KEY = "4zW5KziYxrGKAJsmaTUrnMv4yu9n4VPPbELywUcuCZT3";

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const publicKey = new PublicKey(TREASURY_PUBLIC_KEY);

  console.log("Asking for 2 free devnet SOL...");
  const signature = await connection.requestAirdrop(publicKey, 2_000_000_000); // 2 SOL in lamports
  await connection.confirmTransaction(signature, "confirmed");

  const balance = await connection.getBalance(publicKey);
  console.log(`Success! New balance: ${balance / 1_000_000_000} SOL`);
}

main().catch((err) => {
  console.error("Airdrop failed:", err.message);
  console.log("If this keeps failing, try faucet.solana.com and sign in with GitHub instead.");
});
