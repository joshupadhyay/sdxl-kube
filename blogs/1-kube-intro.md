# Welcome to the Kube

Learning Kubernetes, and the plumbing required with it.

I'm familiar with containerization of applications. Tools like Docker provide a consistent runtime environment to deploy applications and services, such that they work the same regardless of the infrastructure they're on. For the majority of my career, that's been a straightforward process as follows:

1. Find an application, ensure it's stable
2. Write a Dockerfile or Docker-compose
3. Use AWS Elastic Container Service (ECS) and Elastic Container Registry (ECR) to upload the built docker image, and point an ECS cluster at
4. (Networking, Auth, CI/CD...)

The process worked well enough. In the back of my head, though, I'd always put off the next stage of container management - Kubernetes. So here I am, serializing my thoughts:

## Why Kube

Both ECS and Kubernetes are container management and orchestration services. Kubernetes is platform agnostic and exposes more lower primitives than ECS. For most cases I've dealt with in my career (web apps, APIs), if on AWS, I would continue to stick with ECS. But again – Kubernetes is an industry standard, and for Google Cloud, I can imagine it's far superior than EKS. For companies looking across providers, and looking for deep control over orchestration, I can see the appeal. Let's dig in:

## Kubernetes - An Office System

The highest level is the Kubernetes Cluster. It's split into the Control Plane and (plane). The control plane is generally managed by the cloud providers, hosting the K8 API node and kubelet (?).

The data plane (?? the other plane) consists of Nodes. These are containers, each with its own internal network. Pods run within containers, running built container images (like Dockerfiles). There's typically a pod per node. A pod is the atomic unit, running an instance of your application.

The way I think about Kubernetes management is via an office hierarchy. The control plane is the CEO. The CEO communicates with the executive C-suite, which are the kubelets in each Node. The kubelets communicate with the CEO via the kubernetes API, on an internal network.

Each Pod can have probes, which are endpoints defined by the container image. Each kubelet queries the application endpoints (much like boss checking in with employees at standup!) to assess application health, state, and readiness.

<<please make html visualization, and fact check if this is true>>

Accessing an application on a Kubernetes Cluster requires defining a Service. Pods are ephemeral, servers can fail, and thus the IP address of your application can change. We define a Service, an abstraction that handles to specific pods. The Service, as a stable endpoint, can be exposed to the greater network via a load balancer. (I guess a service is like a company blog, where public facing statements are made. Writers can come and go, but the blog is a consistent source of info? You get the idea.)

<<< html visualization, load balancer accessible>>>

## Minikube, EKS

To familiarize myself, I started with `minikube`. [Learn Kubernetes Basics is a fantastic resource](https://kubernetes.io/docs/tutorials/kubernetes-basics/), in particular how the control plane interacts with pods. I won't dive into it here, but I learned about creating a service, creating pods, exposing your application via `kubectl port-forward`.

## Built Container Images

Kubernetes on EKS:

- FastAPI (for some basic endpoints)
- Python
- Dockerfile (to build container image)
- deployment.yml (to specify pods, probe endpoints, service layer, load balancer for public internet access)

Pulumi, and annoyances with it:

- annoying it doesn't create an AWS Stack
- need to manage status separately

Abstraction can be useful for certain practices! Again, I can see this being an advantage with multicloud setups.

## Where We're At...

```bash
curl -i \
  "http://k8s-sdxlkube-sdxlkube-e9c0046555-590515981.us-east-1.elb.amazonaws.com/items/josh"
HTTP/1.1 200 OK
Date: Fri, 15 May 2026 20:57:07 GMT
Content-Type: application/json
Content-Length: 59
Connection: keep-alive
server: uvicorn

{"id":"b1e43cbe-7b3e-4978-87a0-9e89ee8ae082","name":"josh"}%
```
