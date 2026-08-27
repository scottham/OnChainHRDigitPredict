// Generated from forge artifact -- do not edit by hand.
// Regenerate: npx tsx scripts/gen-abi.mjs

export const MNIST_NFT_ABI = [
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "inference",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "input28x28",
        "type": "int256[][]",
        "internalType": "int256[][]"
      }
    ],
    "outputs": [
      {
        "name": "predictedLabel",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      {
        "name": "conv1Shape",
        "type": "uint16[3]",
        "internalType": "uint16[3]"
      },
      {
        "name": "conv1Packed",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "conv1Bias",
        "type": "int256[]",
        "internalType": "int256[]"
      },
      {
        "name": "conv2Shape",
        "type": "uint16[3]",
        "internalType": "uint16[3]"
      },
      {
        "name": "conv2Packed",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "conv2Bias",
        "type": "int256[]",
        "internalType": "int256[]"
      },
      {
        "name": "fcShape",
        "type": "uint16[2]",
        "internalType": "uint16[2]"
      },
      {
        "name": "fcPacked",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "fcBias",
        "type": "int256[]",
        "internalType": "int256[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const
