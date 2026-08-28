"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi"
import { formatEther, type Address, type Hex } from "viem"
import { toast } from "sonner"
import { ArrowLeft, Loader2, Rocket, Stamp } from "lucide-react"

import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"
import LanguagePicker from "@/components/LanguagePicker"
import { MNIST_ABI } from "@/lib/abi"
import { computeFees, padGas } from "@/lib/fees"
import { useT } from "@/lib/i18n"
import { WALLET_CHAINS, chainFor, explorerAddressOn, explorerTxOn } from "@/lib/networks"
import { toMintArgs } from "@/lib/pack"

/**
 * Deploy MNISTPacked and mint a model into it, from the user's own wallet.
 *
 * The scripts in scripts/ do the same two transactions with the key in .env.
 * This page exists for the chain where that key has no funds: the wallet that
 * does can send them itself, and nothing here needs a private key.
 *
 * Both transactions declare an explicit gas limit, because Monad bills the
 * limit rather than the gas used and a wallet's own padding is not free. Each
 * button shows what it will reserve before it is pressed.
 */

/** Fallback when the node will not estimate -- measured on testnet. */
const DEPLOY_GAS_FALLBACK = 3_100_000n
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

type Step = "idle" | "estimating" | "sending" | "waiting" | "done"

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-foreground/90">{value}</dd>
    </div>
  )
}

export default function DeployPage() {
  const t = useT()
  const { address, chainId, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId })
  const { switchChain, isPending: switching } = useSwitchChain()
  const chain = chainFor(chainId)

  const [bytecode, setBytecode] = useState<Hex | null>(null)
  const [params, setParams] = useState<any>(null)
  const [assetError, setAssetError] = useState<string | null>(null)

  const [balance, setBalance] = useState<bigint | null>(null)
  const [deployGas, setDeployGas] = useState<bigint | null>(null)
  const [mintGas, setMintGas] = useState<bigint | null>(null)
  const [feeCap, setFeeCap] = useState<bigint | null>(null)

  const [deployStep, setDeployStep] = useState<Step>("idle")
  const [deployTx, setDeployTx] = useState<string | null>(null)
  const [deployed, setDeployed] = useState<Address | "">("")

  const [mintStep, setMintStep] = useState<Step>("idle")
  const [mintTx, setMintTx] = useState<string | null>(null)
  const [tokenId, setTokenId] = useState<string | null>(null)

  // The bytecode and the weights are static files, fetched rather than bundled:
  // 14 KB of init code and 55 KB of weights have no business in the app's JS.
  useEffect(() => {
    Promise.all([
      fetch("/MNISTPacked.bytecode.txt").then((r) => r.text()),
      fetch("/model-params.json").then((r) => r.json()),
    ])
      .then(([code, model]) => {
        const trimmed = code.trim()
        if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) throw new Error("bad bytecode asset")
        setBytecode(trimmed as Hex)
        setParams(model)
      })
      .catch(() => setAssetError(t.deploy.assetsMissing))
  }, [t])

  const mintArgs = useMemo(() => {
    if (!params) return null
    try {
      return toMintArgs(params)
    } catch {
      return null
    }
  }, [params])

  const weightCount = useMemo(() => {
    if (!mintArgs) return null
    // packed word counts -> int8 weights is not exact, so count the shapes
    const [c1, , , c2, , , fc] = mintArgs
    return c1[0] * c1[1] * c1[2] ** 2 + c2[0] * c2[1] * c2[2] ** 2 + fc[0] * fc[1]
  }, [mintArgs])

  /** Balance and fee cap, refreshed whenever the wallet or chain changes. */
  const refresh = useCallback(async () => {
    if (!publicClient || !address) return
    const [bal, fees] = await Promise.all([
      publicClient.getBalance({ address }),
      computeFees(publicClient).catch(() => null),
    ])
    setBalance(bal)
    setFeeCap(fees?.maxFeePerGas ?? null)
  }, [publicClient, address])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Estimate both transactions up front, so the cost is on screen before
  // anything is signed. A node that refuses to estimate is not a blocker: the
  // measured figure is used and labelled as an estimate.
  useEffect(() => {
    if (!publicClient || !address || !bytecode) return
    let cancelled = false
    publicClient
      .estimateGas({ account: address, data: bytecode })
      .then((g) => !cancelled && setDeployGas(g))
      .catch(() => !cancelled && setDeployGas(DEPLOY_GAS_FALLBACK))
    return () => {
      cancelled = true
    }
  }, [publicClient, address, bytecode])

  useEffect(() => {
    if (!publicClient || !address || !mintArgs || !deployed) return
    let cancelled = false
    publicClient
      .estimateContractGas({
        address: deployed as Address,
        abi: MNIST_ABI,
        functionName: "mint",
        args: mintArgs,
        account: address,
      })
      .then((g) => !cancelled && setMintGas(g))
      .catch(() => !cancelled && setMintGas(null))
    return () => {
      cancelled = true
    }
  }, [publicClient, address, mintArgs, deployed])

  /**
   * Contract creation costs what it costs -- no storage to vary with, so the
   * estimate is exact and padding it would only reserve money for nothing.
   * mint writes ~100 slots and is padded.
   */
  const deployLimit = deployGas
  const mintLimit = mintGas === null ? null : padGas(mintGas)
  const reserved = (gas: bigint | null) => (gas !== null && feeCap !== null ? gas * feeCap : null)

  const symbol = chain?.nativeCurrency.symbol ?? "MON"
  const money = (v: bigint | null) => (v === null ? "—" : `${Number(formatEther(v)).toFixed(4)} ${symbol}`)

  const busy = (s: Step) => s === "sending" || s === "waiting" || s === "estimating"

  const handleDeploy = useCallback(async () => {
    if (!walletClient || !publicClient || !address || !bytecode || !chain) return
    setDeployStep("sending")
    setDeployTx(null)
    try {
      const fees = await computeFees(publicClient)
      const gas = deployGas ?? DEPLOY_GAS_FALLBACK
      const hash = await walletClient.deployContract({
        abi: MNIST_ABI,
        bytecode,
        account: address,
        chain,
        gas,
        ...fees,
      })
      setDeployTx(hash)
      setDeployStep("waiting")
      toast.info(t.deploy.submitted, { description: hash.slice(0, 12) + "…" })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== "success" || !receipt.contractAddress) {
        throw new Error(t.deploy.reverted)
      }
      setDeployed(receipt.contractAddress)
      setDeployStep("done")
      toast.success(t.deploy.deployed, { description: receipt.contractAddress })
      refresh()
    } catch (err: any) {
      setDeployStep("idle")
      toast.error(t.deploy.deployFailed, {
        description: (err?.shortMessage || err?.message || "").split("\n")[0],
      })
    }
  }, [walletClient, publicClient, address, bytecode, chain, deployGas, refresh, t])

  const handleMint = useCallback(async () => {
    if (!walletClient || !publicClient || !address || !mintArgs || !chain) return
    const target = deployed as Address
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      toast.error(t.deploy.badAddress)
      return
    }
    setMintStep("sending")
    setMintTx(null)
    try {
      // A transaction to an address with no code does not revert -- it succeeds
      // as a plain transfer and mints nothing. Ask the wallet's own node.
      const code = (await walletClient.request({
        method: "eth_getCode",
        params: [target, "latest"],
      } as any)) as string
      if (!code || code === "0x") throw new Error(t.deploy.noCode(target))

      const fees = await computeFees(publicClient)
      const estimate =
        mintGas ??
        (await publicClient.estimateContractGas({
          address: target,
          abi: MNIST_ABI,
          functionName: "mint",
          args: mintArgs,
          account: address,
        }))
      const hash = await walletClient.writeContract({
        address: target,
        abi: MNIST_ABI,
        functionName: "mint",
        args: mintArgs,
        account: address,
        chain,
        gas: padGas(estimate),
        ...fees,
      })
      setMintTx(hash)
      setMintStep("waiting")
      toast.info(t.deploy.submitted, { description: hash.slice(0, 12) + "…" })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const transfer = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === target.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[3] !== undefined
      )
      if (!transfer) throw new Error(t.deploy.mintedNothing)
      setTokenId(BigInt(transfer.topics[3]!).toString())
      setMintStep("done")
      toast.success(t.deploy.minted)
      refresh()
    } catch (err: any) {
      setMintStep("idle")
      toast.error(t.deploy.mintFailed, {
        description: (err?.shortMessage || err?.message || "").split("\n")[0],
      })
    }
  }, [walletClient, publicClient, address, mintArgs, chain, deployed, mintGas, refresh, t])

  const deployCost = reserved(deployLimit)
  const mintCost = reserved(mintLimit)
  const shortOfFunds =
    balance !== null && deployCost !== null && deployStep !== "done" && balance < deployCost

  return (
    <div className="min-h-svh bg-gradient-to-b from-background via-background to-violet-950/20">
      <div className="mx-auto flex min-h-svh max-w-3xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src={monadLogo} alt="" width={36} height={36} className="rounded-lg" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{t.deploy.title}</h1>
              <p className="text-xs text-muted-foreground">{t.deploy.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguagePicker />
            <ConnectButton showBalance={false} />
          </div>
        </header>

        <Link
          href="/"
          className="mb-4 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t.deploy.back}
        </Link>

        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t.deploy.intro()}</p>

        {assetError && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {assetError}
          </div>
        )}

        {/* Where the transactions will land. Named, never guessed. */}
        <section className="mb-6 rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur">
          <h2 className="mb-2 text-sm font-medium">{t.deploy.walletTitle}</h2>

          {/*
            The target is the wallet's own chain, never a separate setting: a
            page that thinks it is on mainnet while the wallet is on testnet is
            how a transaction lands where nobody meant it to. These buttons ask
            the wallet to switch, and the rows below report where it actually is.
          */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {WALLET_CHAINS.map((c) => {
              const active = c.id === chainId
              return (
                <button
                  key={c.id}
                  onClick={() => switchChain?.({ chainId: c.id })}
                  disabled={!isConnected || switching || active}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed ${
                    active
                      ? "border-violet-400/70 bg-violet-500/15 text-violet-200"
                      : "border-border/60 bg-black/20 text-muted-foreground hover:border-violet-400/60 disabled:opacity-40"
                  }`}
                >
                  {c.name}
                  {c.id === 143 ? ` · ${t.deploy.mainnetTag}` : ""}
                </button>
              )
            })}
          </div>
          {!isConnected ? (
            <p className="text-xs text-muted-foreground">{t.deploy.connectFirst}</p>
          ) : (
            <dl className="space-y-0.5 text-xs">
              <Row label={t.deploy.chain} value={chain ? `${chain.name} · ${chainId}` : `chainId ${chainId}`} />
              <Row label={t.deploy.account} value={address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—"} />
              <Row label={t.deploy.balance} value={money(balance)} />
              <Row
                label={t.deploy.feeCap}
                value={feeCap === null ? "—" : `${(Number(feeCap) / 1e9).toFixed(1)} gwei`}
              />
            </dl>
          )}
          {isConnected && !chain && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              {t.deploy.unknownChain}
            </p>
          )}
          {chainId === 143 && isConnected && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              {t.deploy.mainnetWarning}
            </p>
          )}
          {shortOfFunds && (
            <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
              {t.deploy.insufficient(money(deployCost), money(balance))}
            </p>
          )}
        </section>

        {/* Step 1 */}
        <section className="mb-4 rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Rocket className="h-4 w-4 text-violet-300" />
            {t.deploy.step1Title}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t.deploy.step1Body}</p>
          <dl className="mb-3 space-y-0.5 text-xs">
            <Row
              label={t.deploy.initCode}
              value={bytecode ? `${(bytecode.length / 2 - 1).toLocaleString()} bytes` : "—"}
            />
            <Row label={t.deploy.gasLimit} value={deployLimit === null ? "—" : deployLimit.toLocaleString()} />
            <Row label={t.deploy.reserves} value={money(deployCost)} />
          </dl>
          <button
            onClick={handleDeploy}
            disabled={!isConnected || !bytecode || !chain || busy(deployStep)}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy(deployStep) && <Loader2 className="h-4 w-4 animate-spin" />}
            {deployStep === "sending"
              ? t.deploy.confirmInWallet
              : deployStep === "waiting"
                ? t.deploy.mining
                : deployStep === "done"
                  ? t.deploy.deployAgain
                  : t.deploy.deployButton}
          </button>
          {deployTx && (
            <p className="mt-2 font-mono text-[11px]">
              <a
                href={explorerTxOn(chain, deployTx) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-violet-300 hover:underline"
              >
                {deployTx.slice(0, 18)}…
              </a>
            </p>
          )}
        </section>

        {/* Step 2 */}
        <section className="mb-4 rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Stamp className="h-4 w-4 text-violet-300" />
            {t.deploy.step2Title}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t.deploy.step2Body}</p>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{t.deploy.contractAddress}</span>
            <input
              value={deployed}
              onChange={(e) => setDeployed(e.target.value.trim() as Address)}
              placeholder="0x…"
              spellCheck={false}
              className="w-full rounded-lg border border-border/60 bg-black/30 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-violet-400/60"
            />
          </label>

          <dl className="mb-3 space-y-0.5 text-xs">
            <Row label={t.deploy.weights} value={weightCount ? `${weightCount.toLocaleString()} × int8` : "—"} />
            <Row
              label={t.deploy.calldata}
              value={mintArgs ? `${(mintArgs[1].length + mintArgs[4].length + mintArgs[7].length).toLocaleString()} words` : "—"}
            />
            <Row label={t.deploy.gasLimit} value={mintLimit === null ? "—" : mintLimit.toLocaleString()} />
            <Row label={t.deploy.reserves} value={money(mintCost)} />
          </dl>

          <button
            onClick={handleMint}
            disabled={!isConnected || !mintArgs || !chain || !deployed || busy(mintStep)}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy(mintStep) && <Loader2 className="h-4 w-4 animate-spin" />}
            {mintStep === "sending"
              ? t.deploy.confirmInWallet
              : mintStep === "waiting"
                ? t.deploy.mining
                : mintStep === "done"
                  ? t.deploy.mintAgain
                  : t.deploy.mintButton}
          </button>
          {mintTx && (
            <p className="mt-2 font-mono text-[11px]">
              <a
                href={explorerTxOn(chain, mintTx) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-violet-300 hover:underline"
              >
                {mintTx.slice(0, 18)}…
              </a>
            </p>
          )}
        </section>

        {tokenId && deployed && (
          <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <h2 className="mb-2 text-sm font-medium text-emerald-200">{t.deploy.doneTitle}</h2>
            <p className="mb-2 text-xs text-emerald-100/80">{t.deploy.doneBody(tokenId)}</p>
            <pre className="overflow-x-auto rounded-lg bg-black/40 p-2.5 font-mono text-[11px] text-emerald-100">
              {`NEXT_PUBLIC_CONTRACT_ADDRESS_${chainId}=${deployed}\nNEXT_PUBLIC_DEFAULT_CHAIN_ID=${chainId}`}
            </pre>
            <a
              href={explorerAddressOn(chain, deployed) ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[11px] text-emerald-300 hover:underline"
            >
              {deployed}
            </a>
          </section>
        )}
      </div>
    </div>
  )
}
