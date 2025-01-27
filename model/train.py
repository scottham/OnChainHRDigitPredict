import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
from torch.utils.data import DataLoader
import os
import json
from copy import deepcopy


class MNISTNet(nn.Module):
    def __init__(self):
        super(MNISTNet, self).__init__()
        self.conv1 = nn.Sequential(
            nn.Conv2d(1, 5, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(kernel_size=2, stride=2)
        )
        self.conv2 = nn.Sequential(
            nn.Conv2d(5, 10, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(kernel_size=2, stride=2)
        )
        self.fc = nn.Sequential(
            nn.Linear(10 * 7 * 7, 10),
        )

    def forward(self, x):
        x = self.conv1(x)
        x = self.conv2(x)
        x = x.view(x.size(0), -1)
        x = self.fc(x)
        return x


def save_weights_to_json(model, filename):
    weights_dict = {
        'conv1': model.conv1[0].weight.data.int().cpu().numpy().tolist(),
        'conv2': model.conv2[0].weight.data.int().cpu().numpy().tolist(),
        'fc': model.fc[0].weight.data.int().cpu().numpy().tolist(),
        'conv1_bias': model.conv1[0].bias.data.int().cpu().numpy().tolist(),
        'conv2_bias': model.conv2[0].bias.data.int().cpu().numpy().tolist(),
        'fc_bias': model.fc[0].bias.data.int().cpu().numpy().tolist()
    }
    with open(filename, 'w') as f:
        json.dump(weights_dict, f, indent=4)


def train(model, device, train_loader, optimizer, epoch):
    model.train()
    for batch_idx, (data, target) in enumerate(train_loader):
        data, target = data.to(device), target.to(device)
        optimizer.zero_grad()
        output = model(data)
        loss = nn.CrossEntropyLoss()(output, target)
        loss.backward()
        optimizer.step()

        if batch_idx % 100 == 0:
            print(f'Train Epoch: {epoch} [{batch_idx * len(data)}/{len(train_loader.dataset)}'
                  f' ({100. * batch_idx / len(train_loader):.0f}%)]\tLoss: {loss.item():.6f}')


def test(model, device, test_loader):
    model.eval()
    test_loss = 0
    correct = 0
    with torch.no_grad():
        for data, target in test_loader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            test_loss += nn.CrossEntropyLoss()(output, target).item()
            pred = output.argmax(dim=1, keepdim=True)
            correct += pred.eq(target.view_as(pred)).sum().item()

    test_loss /= (len(test_loader)) # to fix
    accuracy = 100. * correct / len(test_loader.dataset)
    print(f'\nTest set: Average loss: {test_loss:.4f}, '
          f'Accuracy: {correct}/{len(test_loader.dataset)} ({accuracy:.2f}%)\n')
    return accuracy


def save_best_model(model, accuracy, best_accuracy, epoch):
    if accuracy > best_accuracy:

        os.makedirs('./model/checkpoints', exist_ok=True)
        model_path = f'./model/checkpoints/best_model_epoch_{epoch}_acc_{accuracy:.2f}'
        torch.save(model.state_dict(), f'{model_path}.pth')
        save_weights_to_json(model, f'{model_path}.json')
        return accuracy
    return best_accuracy


def quant_scale(model, scale_factor=1e6):
    with torch.no_grad():
        model.conv1[0].weight.data = torch.round(torch.mul(model.conv1[0].weight.data, scale_factor))
        model.conv2[0].weight.data = torch.round(torch.mul(model.conv2[0].weight.data, scale_factor))
        model.fc[0].weight.data = torch.round(torch.mul(model.fc[0].weight.data, scale_factor))
        model.conv1[0].bias.data = torch.round(torch.mul(model.conv1[0].bias.data, scale_factor))
        model.conv2[0].bias.data = torch.round(torch.mul(model.conv2[0].bias.data, scale_factor))
        model.fc[0].bias.data = torch.round(torch.mul(model.fc[0].bias.data, scale_factor))
   

def main(test_scale_factor):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MNISTNet().to(device)
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    transform = transforms.Compose([
        transforms.ToTensor()
    ])

    train_dataset = torchvision.datasets.MNIST(root='./model/data', train=True, transform=transform, download=True)
    test_dataset = torchvision.datasets.MNIST(root='./model/data', train=False, transform=transform)

    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=64, shuffle=False)

    best_accuracy = 0.0
    epochs = 10
    best_model = quant_scale(deepcopy(model), scale_factor=test_scale_factor)
    for epoch in range(1, epochs + 1):
        train(model, device, train_loader, optimizer, epoch)
        test_model = deepcopy(model)
        quant_scale(test_model, scale_factor=test_scale_factor)
        accuracy = test(test_model, device, test_loader)
        best_model = test_model if accuracy >= best_accuracy else best_model

    best_accuracy = save_best_model(best_model, accuracy, best_accuracy, epoch)


if __name__ == '__main__':
    torch.manual_seed(42)
    main(test_scale_factor=1e6)