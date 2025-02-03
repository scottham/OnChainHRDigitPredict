import json
import time
from web3 import Web3
from pathlib import Path
from tqdm import tqdm

def load_contract_abi(contract_name):
    artifacts_path = Path('model/scripts_for_contracts_and_test/artifacts/contracts') # Compile from hardhat
    contract_path = next(artifacts_path.rglob(f"{contract_name}.json"))
    with open(contract_path) as f:
        contract_json = json.load(f)
    return contract_json['abi'], contract_json['bytecode']


def deploy_contracts():
    # Connect to local Ethereum node
    w3 = Web3(Web3.HTTPProvider('http://localhost:8545'))

    # Get account from private key
    private_key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    account = w3.eth.account.from_key(private_key)
    w3.eth.default_account = account.address

    # Deploy Convolution2D contract
    conv2d_abi, conv2d_bytecode = load_contract_abi("Convolution2D")
    Conv2D = w3.eth.contract(abi=conv2d_abi, bytecode=conv2d_bytecode)
    
    # Build and sign the transaction
    construct_txn = Conv2D.constructor().build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'gas': 3000000,
        'gasPrice': int(w3.eth.gas_price*1.2)
    })
    signed_txn = account.sign_transaction(construct_txn)
    tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
    tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    conv2d_contract = w3.eth.contract(address=tx_receipt.contractAddress, abi=conv2d_abi)
    print(f"Convolution2D deployed to: {tx_receipt.contractAddress}")

    # Deploy FullyConnectedLayer contract
    fc_abi, fc_bytecode = load_contract_abi("FullyConnectedLayer")
    FC = w3.eth.contract(abi=fc_abi, bytecode=fc_bytecode)
    construct_txn = FC.constructor().build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'gas': 3000000,
        'gasPrice': int(w3.eth.gas_price*1.2)
    })
    signed_txn = account.sign_transaction(construct_txn)
    tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
    tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    fc_contract = w3.eth.contract(address=tx_receipt.contractAddress, abi=fc_abi)
    print(f"FullyConnectedLayer deployed to: {tx_receipt.contractAddress}")

    # Deploy MNISTNFT contract
    mnist_abi, mnist_bytecode = load_contract_abi("MNISTNFT")
    MNIST = w3.eth.contract(abi=mnist_abi, bytecode=mnist_bytecode)
    construct_txn = MNIST.constructor(conv2d_contract.address, fc_contract.address).build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'gas': 3000000,
        'gasPrice': int(w3.eth.gas_price*1.2)
    })
    signed_txn = account.sign_transaction(construct_txn)
    tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
    tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    mnist_contract = w3.eth.contract(address=tx_receipt.contractAddress, abi=mnist_abi)
    print(f"MNISTNFT deployed to: {tx_receipt.contractAddress}")

    return w3, account, mnist_contract


def mint_nft(w3, contract, account):  
    # Load model parameters
    with open("model/checkpoints/best_model_epoch_50_acc_97.78.json", "r") as f:
        params = json.load(f)

    conv1_weight = params['conv1']
    conv1_bias = params['conv1_bias']
    conv2_weight = params['conv2']
    conv2_bias = params['conv2_bias']
    fc_weight = params['fc']
    fc_bias = params['fc_bias']

    # Build and sign the transaction
    nonce = w3.eth.get_transaction_count(account.address)
    mint_txn = contract.functions.mint(
        conv1_weight,
        conv1_bias,
        conv2_weight,
        conv2_bias,
        fc_weight,
        fc_bias
    ).build_transaction({
        'from': account.address,
        'nonce': nonce,
        'gas': 80000000,
        'gasPrice': int(w3.eth.gas_price*1.2)
    })
    
    signed_txn = account.sign_transaction(mint_txn)
    tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
    tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print("NFT minted successfully!")
    return 1  # token ID


def run_inference(contract, token_id, input_image=None):
    if input_image is None:
        # Create a 28x28 input array filled with zeros
        input_image = [[0] * 28 for _ in range(28)]

    result = contract.functions.inference(token_id, input_image).call()
    return result


def test_on_mnist_dataset(contract, token_id):
    # Load test images and labels
    with open("model/test_data/mnist_test_data.json", "r") as f:
        test_data = json.load(f)

    test_images = test_data['images']
    test_labels = test_data['labels']

    # Test inference on each image
    correct = 0
    for i, (image, label) in tqdm(enumerate(zip(test_images, test_labels))):
        prediction = contract.functions.inference(token_id, image).call()
        print(f"Image {i}: Predicted {prediction}, Actual {label}")
        if str(prediction) == str(label):
            correct += 1

    accuracy = (correct / len(test_images)) * 100
    print(f"Test Accuracy: {accuracy}%")
    return accuracy


def main():
    # Deploy contracts
    print("Deploying contracts...")
    w3, account, mnist_contract = deploy_contracts()

    # Mint NFT with model parameters
    print("\nMinting NFT with model parameters...")
    token_id = mint_nft(w3, mnist_contract, account)  


    # Run test on MNIST dataset
    print("\nTesting on MNIST dataset...")
    accuracy = test_on_mnist_dataset(mnist_contract, token_id)

    print("\nAll operations completed successfully!")
    print(f"Contract deployed at: {mnist_contract.address}")
    print(f"Token ID: {token_id}")
    print(f"Final accuracy: {accuracy}%")


if __name__ == "__main__":
    main()
