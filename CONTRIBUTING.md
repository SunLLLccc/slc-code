# 贡献指南

## 1. 分支策略

修改代码前必须先创建分支。

| 分支 | 用途 | 创建来源 | 合并目标 | 保护规则 |
|------|------|---------|---------|---------|
| `main` | 生产分支 | — | — | 禁止 push，仅接受 PR，使用 Squash and Merge |
| `feature/<type>-<desc>-<date>` | 功能开发 | `main` | `main` | 无 |
| `hotfix/<desc>-<date>` | 紧急线上修复 | `main` | `main` | 合并后必须打 tag |
| `release/<version>` | 发布候选 | `main` | `main` | 冻结功能，仅修 bug |

`type` = `feat` | `fix` | `refactor` | `docs` | `perf`

示例：`feature-feat-approval-flow-20260430`、`hotfix-jwt-expiry-20260501`、`release/v1.1.0`

## 2. 提交规范

Commit Message 格式：`<type>: <中文描述>`

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: 新增审批管理页面` |
| `fix` | Bug 修复 | `fix: 修复分页参数解析异常` |
| `docs` | 文档变更 | `docs: 更新README缓存架构说明` |
| `style` | 代码格式（不影响逻辑） | `style: 统一缩进为4空格` |
| `refactor` | 重构 | `refactor: 拆分XmlEngine职责` |
| `perf` | 性能优化 | `perf: 优化ResultMapper字段映射` |
| `test` | 测试相关 | `test: 添加QueryOrchestrator单元测试` |
| `chore` | 构建/工具/配置变更 | `chore: 升级Spring Boot至2.7.18` |
| `build` | CI/CD 变更 | `build: 添加PR模板` |

PR 标题与 commit message 格式一致。

## 3. 代码审查

### PR 前置条件

- PR 描述填写完整（变更类型 checklist + 影响范围 + 测试验证 + 风险说明）
- 至少 1 人 review 批准
- 无未解决的 review 评论
- 编译通过 + 测试通过

### 审查清单

- **功能正确性**：实现是否满足需求，逻辑是否正确
- **代码规范**：命名、缩进、注释是否符合项目约定
- **安全性**：是否有 SQL 注入、XSS、硬编码密钥等问题
- **性能影响**：是否有不必要的全表扫描、循环、重复计算
- **测试覆盖**：核心逻辑是否有测试，边界条件是否覆盖
- **兼容性**：是否影响已有接口、配置、数据库结构

### PR 大小控制

单个 PR 变更控制在 400 行以内，大型功能拆分为多个 PR。

## 4. 版本管理

采用 Semantic Versioning：`vMAJOR.MINOR.PATCH`

- **MAJOR**：不兼容的 API 变更（如 XML DSL 语法升级）
- **MINOR**：向后兼容的新功能（如新增 Dubbo 支持）
- **PATCH**：向后兼容的 Bug 修复

发布流程：创建 `release/vX.Y.Z` 分支 → 冻结功能 → 修复问题 → 打 tag → 合并回 `main` → 生成 CHANGELOG
