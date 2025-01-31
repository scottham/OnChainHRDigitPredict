export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0x7a198E9ee6628D0122ffAC2F88f5589D276aD80f";


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
];
