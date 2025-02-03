import torch
import torchvision
import numpy as np
import json

def prepare_mnist_data():
    # Load MNIST dataset
    transform = torchvision.transforms.Compose([
        torchvision.transforms.ToTensor()
    ])
    mnist_test = torchvision.datasets.MNIST(root='./model/data', train=False, 
                                          download=True, transform=transform)
    
    # Select 10 random images
    selected_indices = np.random.choice(len(mnist_test), 10, replace=False)
    test_images = []
    test_labels = []
    
    for idx in selected_indices:
        image, label = mnist_test[idx]
        # Convert to numpy array and scale to int values
        image_np = (image.numpy() * 255).astype(int)
        # Reshape to [1][28][28] format and convert to list
        image_list = image_np.tolist()[0]
        test_images.append(image_list)
        test_labels.append(int(label))
    
    # Save the test data
    test_data = {
        'images': test_images,
        'labels': test_labels
    }
    
    with open('./model/test_data/mnist_test_data.json', 'w') as f:
        json.dump(test_data, f, indent=4)
    
    print(f"Generated test data with {len(test_images)} images")
    print(f"Labels: {test_labels}")

if __name__ == "__main__":
    prepare_mnist_data()
