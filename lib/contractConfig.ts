export type NetworkConfig = {
  name: string;
  rpcUrl: string;
  contractAddress: string;
};

export const networks: NetworkConfig[] = [
  {
    name: 'Monad Testnet',
    rpcUrl: process.env.NEXT_PUBLIC_MONADTESTNET_RPC_URL || '',
    contractAddress: process.env.NEXT_PUBLIC_MONADTESTNET_CONTRACT_ADDRESS || '',
  }

];

// Default to first network
export const DEFAULT_NETWORK = networks[0];


export const CONTRACT_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "int256[][]",
        "name": "input28x28",
        "type": "int256[][]"
      }
    ],
    "name": "inference",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "predictedLabel",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "int256[][][][]",
        "name": "conv1Weight",
        "type": "int256[][][][]"
      },
      {
        "internalType": "int256[]",
        "name": "conv1Bias",
        "type": "int256[]"
      },
      {
        "internalType": "int256[][][][]",
        "name": "conv2Weight",
        "type": "int256[][][][]"
      },
      {
        "internalType": "int256[]",
        "name": "conv2Bias",
        "type": "int256[]"
      },
      {
        "internalType": "int256[][]",
        "name": "fcWeight",
        "type": "int256[][]"
      },
      {
        "internalType": "int256[]",
        "name": "fcBias",
        "type": "int256[]"
      }
    ],
    "name": "mint",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
];
