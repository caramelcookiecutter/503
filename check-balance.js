import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";

const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync("./treasury-keypair.json", "utf8")));
const treasury = Keypair.fromSecretKey(secretKey);

const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
const balance = await connection.getBalance(treasury.publicKey);

console.log("Treasury address:", treasury.publicKey.toBase58());
console.log("Balance:", balance / 1_000_000_000, "SOL");

if (balance === 0) {
  console.log("This wallet has NO SOL yet — fund it before running create-token.js");
}
