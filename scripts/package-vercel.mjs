import { cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
const output = ".vercel/output"
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
cpSync("dist", `${output}/static`, { recursive: true })
writeFileSync(`${output}/config.json`, JSON.stringify({ version: 3 }, null, 2) + "\n")
console.log("Packaged static files only; no Vercel Functions or inference API.")
