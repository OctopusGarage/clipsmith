# Summary

这篇文章讨论 AI 系统架构从“自建 Agent”走向“Agent Runtime + Skill”的演进。文章区分了 LLM、Agent、Tool 与 Skill 的职责：LLM 是推理引擎，Agent 是任务编排与执行系统，Skill 则是带有业务语义和使用方式的能力封装。

文章比较了自建 Agent 与 Agent Runtime 两种构建方式：前者控制力更强但复杂度更高，适合多分支、强状态和高可靠性场景；后者由平台或 SDK 接管编排，适合标准化流程。随后文章讨论 Skill Loader、MCP、Skill 与 CLI/API 的三层能力体系，以及 Coding Agent 如何逐步演化为通用 Agent Runtime。

核心结论是：Agent Runtime 正在基础设施化，Agent 本身会变得可替换；真正值得长期沉淀的是 Skill，即可执行、可复用、结构化的知识与业务能力。
