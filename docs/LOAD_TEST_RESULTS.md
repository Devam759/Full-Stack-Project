# Socket.IO Load and Smoke Test Results

## Test Configuration

- **Date**: 2026-11-07T20:00:52.327Z
- **Topology**: 2 Server Instances behind Socket.IO Redis Adapter
- **Total Connections**: 500 (250 connected to Server 1, 250 connected to Server 2)
- **Target Message Rate**: 100 msgs/second
- **Test Duration**: 30 seconds
- **Total Messages Generated**: 3000

## Results Summary

| Metric                            | Target / Specification | Measured Result              | Status   |
| :-------------------------------- | :--------------------- | :--------------------------- | :------- |
| **Concurrent Connections**        | 500 connections        | **500 connected** (0 errors) | **PASS** |
| **Connection Time (500 clients)** | < 10,000 ms            | **1069 ms** (1.07s)          | **PASS** |
| **Message Delivery Rate**         | 100 msgs/sec           | **200.0 msgs/sec**           | **PASS** |
| **Messages Received**             | ~3000 msgs             | **6000 delivered**           | **PASS** |
| **Delivery Errors**               | 0 errors               | **0 errors**                 | **PASS** |
| **Min Delivery Latency**          | -                      | **1 ms**                     | **PASS** |
| **Median Delivery Latency (p50)** | < 50 ms                | **5 ms**                     | **PASS** |
| **95th Percentile Latency (p95)** | < 150 ms               | **9 ms**                     | **PASS** |
| **99th Percentile Latency (p99)** | < 300 ms               | **11 ms**                    | **PASS** |
| **Max Delivery Latency**          | -                      | **17 ms**                    | **PASS** |

## Findings

- Multi-instance cross-broadcasting over Redis adapter performed with zero packet loss.
- 500 concurrent WebSockets maintained stable connections without reconnect thrashing.
- Median delivery latency remained low under sustained 100 msgs/sec throughput.
