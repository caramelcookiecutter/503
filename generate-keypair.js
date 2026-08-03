import { Keypair } from "@solana/web3.js";
import fs from "fs";

// Make a brand new wallet (like a locked piggy bank with its own address)
const treasury = Keypair.generate();

fs.writeFileSync(
  "./treasury-keypair.json",
  JSON.stringify(Array.from(treasury.secretKey))
);

console.log("New treasury wallet created!");
console.log("Public address (safe to share):", treasury.publicKey.toBase58());
console.log("Secret key saved to treasury-keypair.json — keep this file private!");
