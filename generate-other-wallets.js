import { Keypair } from "@solana/web3.js";
import fs from "fs";

const wallets = [
  { name: "founder", file: "founder-keypair.json" },
  { name: "traders", file: "traders-keypair.json" },
];

for (const { name, file } of wallets) {
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`${name} wallet created!`);
  console.log(`  Public address: ${kp.publicKey.toBase58()}`);
  console.log(`  Secret saved to: ${file} — keep this private!`);
}
