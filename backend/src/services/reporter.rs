use crate::models::pipeline::TestPipeline;
use crate::services::runner::CaseExecutionResult;
use chrono::Local;
use std::fs;
use std::path::PathBuf;

/// 把报告落盘为 `.md` 文件，返回文件名（不含目录）。
///
/// 目录默认 `data/reports`，文件名 `{项目名}-{yyyyMMdd-HHmmss}.md`，
/// 项目名里的特殊字符会替换为 `_`，保证跨平台可用。
pub fn save_report(dir: &str, project_name: &str, markdown: &str) -> Result<String, String> {
    let safe_name: String = project_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe_name = if safe_name.trim_matches('_').is_empty() {
        "report".to_string()
    } else {
        safe_name
    };
    let file_name = format!(
        "{}-{}.md",
        safe_name,
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = PathBuf::from(dir).join(&file_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建报告目录失败 {}: {}", parent.display(), e))?;
    }
    fs::write(&path, markdown)
        .map_err(|e| format!("写入报告失败 {}: {}", path.display(), e))?;
    Ok(file_name)
}

pub fn generate_markdown_report(
    pipeline: &TestPipeline,
    results: &[CaseExecutionResult],
) -> String {
    let total = results.len();
    let passed = results.iter().filter(|r| r.passed).count();
    let failed = total.saturating_sub(passed);
    let pass_rate = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let mut md = String::new();
    md.push_str(&format!("# {} - 自动化反例测试报告\n\n", pipeline.project_name));
    md.push_str(&format!(
        "- **生成时间**: {}\n- **目标地址**: `{}`\n- **前置依赖步骤数**: {} 个\n- **总反例数**: {} | **通过**: {} | **失败/未拦截**: {} | **通过率**: {:.1}%\n\n",
        Local::now().format("%Y-%m-%d %H:%M:%S"),
        pipeline.base_url,
        pipeline.pre_steps.len(),
        total,
        passed,
        failed,
        pass_rate
    ));

    // 1. 业务测试需求矩阵
    md.push_str("## 一、产品文档拆解测试需求矩阵\n\n");
    md.push_str("| 需求 ID | 所属模块 | 需求标题 | 关联接口 | 核心业务与校验规则 |\n");
    md.push_str("| :--- | :--- | :--- | :--- | :--- |\n");
    for req in &pipeline.requirements {
        md.push_str(&format!(
            "| `{}` | {} | {} | `{}` | {} |\n",
            req.req_id, req.module, req.title, req.target_endpoint, req.business_rule
        ));
    }
    md.push('\n');

    // 2. 前置依赖步骤说明（如登录拿 Token）
    if !pipeline.pre_steps.is_empty() {
        md.push_str("## 二、前置依赖步骤 (Pre-Request Hooks)\n\n");
        for (idx, step) in pipeline.pre_steps.iter().enumerate() {
            md.push_str(&format!(
                "{}. **{}** (`{} {}`) → 提取变量规则: `{:?}`\n",
                idx + 1,
                step.description,
                step.method,
                step.path,
                step.extract_rules
            ));
        }
        md.push('\n');
    }

    // 3. 反例执行总览表
    md.push_str("## 三、反例测试用例执行结果汇总\n\n");
    md.push_str("| 用例 ID | 变异维度 | 用例名称 | 接口 | 预期状态码 | 实际状态码 | 耗时 | 结果 |\n");
    md.push_str("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n");
    for r in results {
        let badge = if r.passed { "PASS" } else { "FAIL" };
        md.push_str(&format!(
            "| `{}` | {} | {} | `{} {}` | `{:?}` | `{}` | {}ms | **{}** |\n",
            r.case_id,
            r.category,
            r.title,
            r.method,
            r.url.trim_start_matches(&pipeline.base_url),
            r.expected_status_codes,
            r.actual_status,
            r.duration_ms,
            badge
        ));
    }
    md.push('\n');

    // 4. 失败与异常反例复现详情
    let failed_cases: Vec<&CaseExecutionResult> = results.iter().filter(|r| !r.passed).collect();
    if !failed_cases.is_empty() {
        md.push_str("## 四、失败用例与一键复现详情\n\n");
        for fc in failed_cases {
            md.push_str(&format!("### [{}] {}\n\n", fc.case_id, fc.title));
            md.push_str(&format!(
                "- **失败原因**: {}\n- **实际响应片段**: `{}`\n- **一键复现 cURL**:\n\n```bash\n{}\n```\n\n",
                fc.failure_reason.as_deref().unwrap_or("未知原因"),
                fc.response_snippet,
                fc.curl_reproduce
            ));
        }
    }

    md
}
