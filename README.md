# GPU Finder

GPU Finder is a web application that allows users to browse, search, compare, analyze, and rank different graphics cards.

The website gets its GPU information from a REST API instead of storing the GPU data directly inside the frontend.

## How the Website Uses the API

The website connects to the GPU Finder API to retrieve the available GPU data.

The API provides information such as:

- GPU brand
- Model
- Series
- Architecture
- VRAM
- Memory type
- Core count
- Memory bandwidth
- Base and boost clock
- Power consumption
- Recommended PSU
- PCIe interface
- Process node
- Release date
- Launch price
- Description

The frontend sends a request to the API and receives the GPU data in JSON format.

Example request:

```text
GET /gpus
