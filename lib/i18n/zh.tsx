import type { ReactNode } from "react"

import type { Messages } from "./index"
import { Mono } from "./parts"

/**
 * Simplified Chinese. Typed as `Messages`, so this file cannot drift out of
 * sync with en.tsx without failing the build.
 *
 * Identifiers stay in their original form on purpose: MNISTNFT, conv2D, relu,
 * gasUsed, pool1 and the env var names are things you type or grep for, not
 * prose. Translating them would make the page describe code that does not
 * exist.
 */
export const zh: Messages = {
  meta: {
    title: "链上手写数字识别",
  },
  common: {
    noNetwork: "无网络",
    reading: "读取中…",
    none: "—",
  },
  language: {
    label: "语言",
  },
  header: {
    title: "链上手写数字识别",
    tagline: "每一次乘加运算都在 EVM 合约里执行",
  },
  network: {
    label: "网络",
    mainnetSuffix: " · 主网",
  },
  banner: {
    missingContract: (address, network, envVar): ReactNode => (
      <>
        在 {network} 上的 <Mono>{address}</Mono> 没有合约代码。这条链可能又被重置了 —— 请重新部署并更新{" "}
        <Mono>{envVar}</Mono>。
      </>
    ),
    unconfigured: (): ReactNode => (
      <>
        没有配置任何网络。请把 <Mono>NEXT_PUBLIC_CONTRACT_ADDRESS_&lt;chainId&gt;</Mono>{" "}
        设为已部署的注册表地址 —— 参见 <Mono>.env.example</Mono>。
      </>
    ),
    localNode: (nodeChainId, walletChainId, network): ReactNode => (
      <>
        本应用正在读取本地节点（chainId {nodeChainId}），而你的钱包在链 {walletChainId} 上。
        浏览器钱包无法向本地节点写入 —— 运行 <Mono>npm run dev</Mono> 以使用 {network}。
      </>
    ),
    wrongChain: (walletChainId, reading) =>
      `钱包在链 ${walletChainId} 上，而本应用正在读取 ${reading}。`,
    switchTo: (network) => `切换到 ${network}`,
  },
  canvas: {
    title: "写一个数字",
    range: "0 – 9",
    brush: "笔刷",
    clear: "清除",
    predict: "预测",
    predicting: "正在链上运行…",
    readOnlyNote: "推理是只读调用 —— 不需要钱包、不消耗 gas、不需要签名。",
  },
  prediction: {
    title: "预测结果",
    latency: "延迟",
    network: "网络",
    token: "Token",
    ms: (ms) => `${ms} 毫秒`,
    inputCaption: "模型实际收到的输入（28×28）",
  },
  model: {
    title: "模型",
    token: "Token",
    defaultSuffix: "（默认）",
    architecture: "网络结构",
    weights: "权重",
    biases: "偏置",
    owner: "持有者",
    accuracy: "测试集准确率",
    notMinted: "未铸造",
    notMeasured: "未测量",
    weightsValue: (weights, words) => `${weights} 个 int8，占 ${words} 个存储字`,
    biasesValue: (biases) => `${biases} × int256`,
    accuracyNote:
      "准确率不存在链上。98.13% 是本仓库自己那个模型在 MNIST 测试集上离线测得的结果；其它 token 的权重如何，一无所知。",
    tokenLink: (tokenId) => `token #${tokenId}`,
  },
  mint: {
    title: "铸造你自己的模型",
    advanced: "进阶",
    intro: (): ReactNode => (
      <>
        上传 <Mono>model/train.py</Mono> 生成的 JSON。一笔交易，一次确认。
      </>
    ),
    choose: "选择参数 JSON 文件",
    connect: "连接钱包后铸造",
    minting: "铸造中…",
    submit: "铸造模型 NFT",
  },
  execution: {
    title: "链上执行",
    empty: "先跑一次预测，这里会回放它在链上发出的那次调用。",
    blockLabel: (network, block) => `${network} · 区块 #${block}`,
    axisGas: "x = 已消耗的 gas（EVM 的时钟）",
    axisIndex: "x = 调用序号（同一批调用，等距排列）",
    summary: (calls, contracts, gas, atLeast, blockShare): ReactNode => (
      <>
        一次预测是横跨 {contracts} 个合约的 {calls} 次外部调用，烧掉{atLeast ? "至少 " : ""}
        {gas} gas —— 相当于一个 Monad 区块的 {blockShare}%。下面两条带子展示的是
        <em>哪个合约正在执行、以及它的开销</em>。这里的一切都来自产生该预测的那一次被追踪的调用；
        网络并没有被要求把推理跑两遍。
      </>
    ),
    gasUnknownNote: (): ReactNode => (
      <>
        {" "}
        （这个 RPC 把<em>提供</em>的 gas 当作根调用的 <Mono>gasUsed</Mono> 上报，
        因此总量改为对各次外部调用求和得出。）
      </>
    ),
    replayNote: (realMs): ReactNode => (
      <>
        回放按真实速度进行 —— 它持续的正是这次调用实际花掉的 {realMs} 毫秒，所以几乎还没看清就结束了。
        在这段时间里，播放头是按 <strong>gas 而不是秒</strong> 推进的：trace 只记录每次调用花了多少，
        从不记录它何时发生，gas 是 EVM 唯一的逐步时钟。拖动滑块可以手动逐步查看。
      </>
    ),
    role: {
      MNISTNFT: "存放权重，驱动前向传播",
    },
    card: {
      callsIn: "收到调用",
      selfGas: "自身 gas",
      gas: "gas",
      storageRead: "读取存储",
      code: "代码",
      words: (n) => `${n} 个字`,
      kilobytes: (kb) => `${kb} KB`,
    },
    seekLabel: "在调用序列中拖动定位",
    pause: "暂停",
    play: "播放",
    replay: (ms) => `重放（${ms} 毫秒）`,
    timing: "正在计时各层…",
    retime: "重新计时各层",
    timeLayers: "实测每一层耗时",
    hover: "悬停",
    step: "步进",
    position: (current, total) => `${current}/${total}`,
    callGas: (gas) => `${gas} gas`,
    gasOfTotal: (used, total) => `${used} / ${total} gas`,
    msInto: (at, total) => `≈ 已进行 ${at}/${total} 毫秒`,
    stageTimesNote: (realMs): ReactNode => (
      <>
        绿色数字是实测墙钟时间：用 trace 记录下来的 calldata 把每一层作为独立的{" "}
        <Mono>eth_call</Mono> 重新发一遍测得 —— 数学合约是纯函数，所以重放返回逐字节相同的输出。
        每个数字只覆盖该层自身的那次调用（逐元素的 <span className="font-mono">relu</span>{" "}
        调用不会被重发），并且包含一次 RPC 往返，因此它们并不能把合并调用的 {realMs} 毫秒拆解开。
      </>
    ),
    weightsFrom: (label): ReactNode => (
      <>
        权重读自 <span className="font-mono">{label}</span> 的存储
      </>
    ),
    loadingLayout: "读取中…",
    showStorage: "显示读取的存储",
    noPrestate: "该节点未提供 prestateTracer。",
    storageHint:
      "这需要再追踪执行一次，之后会缓存 —— 对每张图片权重都相同，所以每个模型只问一次。",
    slotsRead: (n) => `读取了 ${n} 个存储字 · 每个字打包 32 个 int8 权重`,
    slotDetail: (index, head, tail) => `slot ${index}：${head}…${tail}`,
  },
  trace: {
    title: "执行追踪",
    badge: "链上实测",
    intro: (): ReactNode => (
      <>
        下面每一个激活值都是链上调用的真实返回值，通过 <Mono>debug_traceCall</Mono> 读回 ——
        正是产生该预测的那一次调用。这里没有任何东西是在浏览器里重算的。
      </>
    ),
    loading: "正在追踪执行…",
    empty: "先跑一次预测，这里会逐层展示执行过程。",
    input: "输入",
    channel: (index) => `通道 ${index}`,
    externalCalls: (n) => `${n} 次外部调用`,
    reluCalls: (n) => `${n} × relu()`,
    traceSize: (mb) => `${mb} MB trace`,
    elapsed: (ms) => `${ms} 毫秒`,
    elapsedTitle:
      "预测和这份 trace 来自同一次被追踪的调用：这是那次调用花掉的时间，包含传输和解析 trace JSON 的开销。",
  },
  footer: {
    source: "在 GitHub 上查看源码",
  },
  toast: {
    drawFirst: "请先写一个数字",
    noModelTitle: (tokenId) => `Token ${tokenId} 没有模型`,
    noModelBody: "这个 id 下没有存储权重。试试 token 1，或者在下方铸造一个模型。",
    traceFailed: (detail) => `无法追踪这次调用：${detail}`,
    inferenceFailed: "推理失败",
    noNetwork: "没有配置网络",
    uploadFirst: "请先上传参数文件",
    chainUnknownTitle: "仍在确认该 RPC 服务的是哪条链",
    chainUnknownBody: "请稍候再试。",
    wrongNetworkTitle: "网络不对",
    wrongNetworkBody: (walletChainId, readingChainId) =>
      `你的钱包在链 ${walletChainId} 上，而本应用正在读取链 ${readingChainId}。`,
    noContractOnWalletChain: (address) => `在你钱包所连的链上，${address} 处没有合约。`,
    mintSubmitted: "铸造交易已提交",
    mintedNothing: "交易上链了，但什么也没铸造出来 —— 合约没有发出 Transfer 事件。",
    mintedTitle: (tokenId) => `已铸造 token ${tokenId}`,
    mintedBody: "已选中用于推理。",
    mintFailed: "铸造失败",
    weightsOutOfRange: "权重超出 int8 范围。请用当前的 train.py 重新生成。",
    paramsLoaded: "参数已载入",
    readFileFailed: "无法读取文件",
    missingKeys: (keys) => `缺少字段：${keys}`,
    unknownError: "未知错误",
  },
}
