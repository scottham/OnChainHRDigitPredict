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
    summary: (gas, blockShare): ReactNode => (
      <>
        一次预测是<strong>一次调用，且不发出任何外部调用</strong>，烧掉 {gas} gas —— 相当于一个
        Monad 区块的 {blockShare}%。这里没有 trace 可看：MNISTPacked 把每一层都在自己内部算完，
        这也正是它只需要「每层一次跨合约调用」那种实现五分之一开销的主要原因。所以下面这条带子是
        <em>实测</em>而不是 trace：每一段都是把流水线截断在相邻两层、各做一次{" "}
        <Mono>eth_estimateGas</Mono> 之后的差值。
      </>
    ),
    noEstimate: "该节点不提供 gas 估算，因此无法给出逐层开销。",
    replayNote: (realMs): ReactNode => (
      <>
        回放按真实速度进行 —— 它持续的正是这次调用实际花掉的 {realMs} 毫秒，所以几乎还没看清就结束了。
        在这段时间里，播放头是按 <strong>gas 而不是秒</strong> 推进的：链上不记录某一层何时执行，
        只记录它花了多少，gas 是 EVM 唯一的逐步时钟 —— 而且从这里也量不出某一层的墙钟时间，
        一次 RPC 往返就比整次预测还长。拖动滑块可以手动逐步查看。
      </>
    ),
    stageLabel: {
      load: "读取模型",
      pack: "打包输入",
      conv1: "conv1 + ReLU",
      pool1: "pool1",
      conv2: "conv2 + ReLU",
      pool2: "pool2",
      flatten: "flatten",
      fc: "fc",
    },
    role: {
      MNISTPacked: "存放权重，并独自完成整个前向传播",
    },
    card: {
      callsIn: "收到调用",
      externalCalls: "发出调用",
      gas: "gas",
      storageRead: "读取存储",
      code: "代码",
      words: (n) => `${n} 个字`,
      kilobytes: (kb) => `${kb} KB`,
    },
    seekLabel: "在前向传播中拖动定位",
    pause: "暂停",
    play: "播放",
    replay: (ms) => `重放（${ms} 毫秒）`,
    hover: "悬停",
    step: "阶段",
    position: (current, total) => `${current}/${total}`,
    stageGas: (gas) => `${gas} gas`,
    gasOfTotal: (used, total) => `${used} / ${total} gas`,
    msInto: (at, total) => `≈ 已进行 ${at}/${total} 毫秒`,
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
    title: "执行轨迹",
    badge: "链上实测",
    intro: (): ReactNode => (
      <>
        下面每一张激活图都是链上调用的真实返回值。<Mono>MNISTPacked.activations()</Mono>{" "}
        会把前向传播重跑一遍、停在那一层，并把该层打包在字内的 lane 解开，
        所以你看到的就是合约自己算出来的东西。这里没有任何一步是在浏览器里重算的。
      </>
    ),
    loading: "正在逐层执行…",
    empty: "先跑一次预测，这里会显示逐层的执行过程。",
    input: "输入",
    channel: (index) => `通道 ${index}`,
    noExternalCalls: "0 次外部调用",
    gasTotal: (gas) => `${gas} gas`,
    elapsed: (ms) => `${ms} 毫秒`,
    elapsedTitle:
      "这是预测调用本身花掉的时间。上面的激活图是之后并行取回的，不计入其中。",
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
