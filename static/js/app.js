/* ============================================================
   工程质量监督智能匹配Agent - 前端交互逻辑
   ============================================================ */

// ===== 全局状态 =====
let problemCounter = 0;
let noticeTextCache = "";
let llmProviders = {};
let llmConfig = { enabled: false };
let lastMatchResults = null;
let currentMatchResults = [];
let pendingReviewData = null;
let searchedRegulation = null;
let pdfRegulation = null;
let manualRegulation = null;

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    loadStats();
    loadRegulations();
    loadLLMProviders();
    loadLLMConfig();
    // 设置默认日期为今天
    document.getElementById("inspectionDate").value = new Date().toISOString().split("T")[0];
});

// ===== Tab 切换 =====
function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var target = this.getAttribute("data-tab");
            document.querySelectorAll(".tab-btn").forEach(function (b) {
                b.classList.remove("active");
            });
            document.querySelectorAll(".tab-panel").forEach(function (p) {
                p.classList.remove("active");
            });
            this.classList.add("active");
            document.getElementById("tab-" + target).classList.add("active");
        });
    });
}

// ===== 统计信息 =====
function loadStats() {
    fetch("/api/stats")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            document.getElementById("statRegulations").textContent = data.regulations;
            document.getElementById("statClauses").textContent = data.clauses;
            document.getElementById("statCategories").textContent = data.categories.length;
        })
        .catch(function () {
            showToast("加载统计信息失败", "error");
        });
}

// ===== 问题匹配 =====
function matchProblem() {
    var problem = document.getElementById("problemInput").value.trim();
    var location = document.getElementById("locationInput").value.trim();
    var topN = parseInt(document.getElementById("topNSelect").value);
    var mode = document.getElementById("matchModeSelect").value;

    if (!problem) {
        showToast("请输入问题描述", "error");
        return;
    }

    // AI模式或混合模式需要检查API Key配置
    if ((mode === "ai" || mode === "hybrid") && !isAIReady()) {
        showToast("请先配置大模型API Key", "error");
        openAIConfigModal();
        return;
    }

    var btn = document.getElementById("matchBtn");
    btn.disabled = true;
    var btnText = mode === "ai" ? "AI匹配中..." : (mode === "hybrid" ? "混合匹配中..." : "匹配中...");
    btn.innerHTML = '<span class="btn-icon">⏳</span> ' + btnText;

    var resultsDiv = document.getElementById("matchResults");
    var loadingText = mode === "ai" ? "AI正在分析问题并匹配规范条款..." :
                      (mode === "hybrid" ? "正在执行关键词+AI混合匹配..." : "正在匹配规章制度...");
    resultsDiv.innerHTML = '<div class="loading-state">' + loadingText + '</div>';

    var apiUrl, reqBody;

    if (mode === "ai") {
        apiUrl = "/api/llm/match";
        reqBody = { problem: problem, location: location };
    } else if (mode === "hybrid") {
        apiUrl = "/api/match/hybrid";
        reqBody = { problem: problem, location: location, top_n: topN, use_ai: true };
    } else {
        apiUrl = "/api/match";
        reqBody = { problem: problem, location: location, top_n: topN };
    }

    fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody)
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + data.error + '</p></div>';
                btn.disabled = false;
                btn.innerHTML = '<span class="btn-icon">🔍</span> 开始匹配';
                return;
            }

            currentMatchResults = data.matches || [];
            document.getElementById("addAllMatchesBtn").style.display = currentMatchResults.length > 0 ? "" : "none";

            if (mode === "hybrid" && data.ai_matches) {
                renderHybridResults(data);
            } else if (mode === "ai") {
                renderAIResults(data);
            } else {
                renderMatchResults(data);
            }

            // 显示AI分析按钮
            if (llmConfig.enabled) {
                document.getElementById("aiAnalyzeBtn").style.display = "";
            }

            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">🔍</span> 开始匹配';
        })
        .catch(function () {
            resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>匹配请求失败，请检查服务是否运行</p></div>';
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">🔍</span> 开始匹配';
            showToast("匹配请求失败", "error");
        });
}

function renderMatchResults(data) {
    var div = document.getElementById("matchResults");
    var countSpan = document.getElementById("resultCount");

    if (!data.matches || data.matches.length === 0) {
        div.innerHTML = '<div class="empty-state">' +
            '<div class="empty-icon">📭</div>' +
            '<p>未找到匹配的规范条款</p>' +
            '<p class="empty-hint">请尝试调整问题描述的关键词，或在规章制度库中导入更多规范</p>' +
            '</div>';
        countSpan.textContent = "";
        return;
    }

    countSpan.textContent = "共 " + data.total + " 条匹配";

    var html = "";
    data.matches.forEach(function (m, idx) {
        var levelClass = "";
        var levelText = "";
        if (m.match_level === "高") { levelClass = "high"; levelText = "高匹配"; }
        else if (m.match_level === "中") { levelClass = "medium"; levelText = "中匹配"; }
        else { levelClass = "low"; levelText = "低匹配"; }

        var mandatoryBadge = m.is_mandatory_reg
            ? '<span class="mandatory-badge">强制性标准</span>' : '';

        var keywordHtml = "";
        if (m.keywords && m.keywords.length > 0) {
            keywordHtml = '<div class="match-keywords">' +
                '<span class="match-keywords-label">关键词：</span>';
            m.keywords.forEach(function (kw) {
                var isMatched = m.matched_keywords && m.matched_keywords.indexOf(kw) >= 0;
                keywordHtml += '<span class="keyword-tag' + (isMatched ? ' matched' : '') + '">' +
                    (isMatched ? "✓ " : "") + kw + '</span>';
            });
            keywordHtml += '</div>';
        }

        var detailsHtml = "";
        if (m.match_details && m.match_details.length > 0) {
            detailsHtml = '<div style="margin-top:6px;font-size:12px;color:#9ca3af">' +
                m.match_details.join("；") + '</div>';
        }

        html += '<div class="match-item">' +
            '<div class="match-item-header">' +
                '<div class="match-reg-info">' +
                    '<div class="match-reg-name">' +
                        '《' + m.regulation_full_name + '》' + mandatoryBadge +
                    '</div>' +
                    '<div class="match-reg-code">' + m.regulation_code + '</div>' +
                    '<span class="match-clause-num">第 ' + m.clause_number + ' 条</span>' +
                '</div>' +
                '<div class="match-score">' +
                    '<div class="match-percentage ' + levelClass + '">' + m.match_percentage + '%</div>' +
                    '<div class="match-level-badge ' + levelClass + '">' + levelText + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="match-clause-content">' + m.clause_content + '</div>' +
            keywordHtml +
            detailsHtml +
            '<div class="match-actions">' +
                '<button class="btn btn-xs btn-cute" onclick="addMatchToNotice(' + idx + ')">✨ 加入通知书</button>' +
            '</div>' +
        '</div>';
    });

    div.innerHTML = html;
}

// ===== 示例问题 =====
function useExample(el) {
    document.getElementById("problemInput").value = el.textContent;
    document.getElementById("problemInput").focus();
}

function loadExample() {
    document.getElementById("problemInput").value =
        "管线穿越防火隔墙时部分孔洞缺防火封堵";
    showToast("已加载示例", "info");
}

function clearProblem() {
    document.getElementById("problemInput").value = "";
    document.getElementById("locationInput").value = "";
    document.getElementById("matchResults").innerHTML = '<div class="empty-state">' +
        '<div class="empty-icon">🔍</div>' +
        '<p>请输入问题描述后点击"开始匹配"</p>' +
        '<p class="empty-hint">系统将自动从规章制度库中查找匹配的条款</p>' +
        '</div>';
    document.getElementById("resultCount").textContent = "";
    document.getElementById("addAllMatchesBtn").style.display = "none";
    currentMatchResults = [];
}

// ===== 匹配结果 → 通知书 =====
function addMatchToNotice(matchIdx) {
    var m = currentMatchResults[matchIdx];
    if (!m) return;

    var problemDesc = document.getElementById("problemInput").value.trim();
    if (!problemDesc) {
        showToast("请先输入问题描述", "error");
        return;
    }

    // 切换到通知书Tab
    switchTab("notice");

    // 添加新问题行
    var rowId = addProblemRowWithMatch(problemDesc, [m]);
    showToast("已加入通知书 ✨", "success");
}

function addAllMatchesToNotice() {
    if (!currentMatchResults || currentMatchResults.length === 0) {
        showToast("没有可添加的匹配结果", "error");
        return;
    }

    var problemDesc = document.getElementById("problemInput").value.trim();
    if (!problemDesc) {
        showToast("请先输入问题描述", "error");
        return;
    }

    switchTab("notice");
    addProblemRowWithMatch(problemDesc, currentMatchResults);
    showToast("已生成通知书模板 ✨", "success");
}

function addProblemRowWithMatch(description, matches) {
    problemCounter++;
    var list = document.getElementById("problemList");
    document.getElementById("problemListEmpty").style.display = "none";

    var div = document.createElement("div");
    div.className = "problem-row";
    div.id = "problemRow_" + problemCounter;
    div.dataset.matches = JSON.stringify(matches || []);

    var refs = "";
    if (matches && matches.length > 0) {
        refs = matches.slice(0, 3).map(function (m) {
            return '<span class="matched-ref">《' + m.regulation_full_name + '》' +
                m.regulation_code + ' 第' + m.clause_number + '条</span>';
        }).join("、");
    }

    div.innerHTML =
        '<div class="problem-row-header">' +
            '<span class="problem-row-num">问题 ' + problemCounter + '</span>' +
            '<button class="btn btn-xs btn-outline" onclick="removeProblemRow(' + problemCounter + ')">删除</button>' +
        '</div>' +
        '<textarea class="form-control" placeholder="输入现场发现的问题描述..." rows="2">' + escapeHtml(description) + '</textarea>' +
        '<div class="problem-match-result" id="problemMatch_' + problemCounter + '" style="display:' + (refs ? 'block' : 'none') + '">匹配规范：' + refs + '</div>';

    list.appendChild(div);
    return problemCounter;
}

function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.remove("active");
        if (b.getAttribute("data-tab") === tabName) b.classList.add("active");
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.classList.remove("active");
    });
    document.getElementById("tab-" + tabName).classList.add("active");
}

// ===== 规章制度库 =====
function loadRegulations() {
    fetch("/api/regulations")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            renderRegulations(data.regulations);
            loadStats();
        })
        .catch(function () {
            document.getElementById("regulationList").innerHTML =
                '<div class="empty-state"><p>加载失败</p></div>';
        });
}

function renderRegulations(regs) {
    var div = document.getElementById("regulationList");
    if (!regs || regs.length === 0) {
        div.innerHTML = '<div class="empty-state"><p>暂无规章制度数据</p></div>';
        updateBatchBar();
        return;
    }

    var html = "";
    regs.forEach(function (reg) {
        var badge = reg.is_mandatory
            ? '<span class="reg-item-badge badge-mandatory">强制性</span>'
            : '<span class="reg-item-badge badge-normal">推荐性</span>';

        var clauseCount = reg.clause_count || "?";

        html += '<div class="regulation-item" data-reg-id="' + reg.id + '">' +
            '<label class="reg-checkbox" onclick="event.stopPropagation()">' +
                '<input type="checkbox" class="reg-select-cb" value="' + reg.id + '" onchange="onRegSelectChange()">' +
                '<span class="checkmark"></span>' +
            '</label>' +
            '<div class="reg-item-info" onclick="showRegDetail(' + reg.id + ')">' +
                '<div class="reg-item-name">《' + escapeHtml(reg.full_name || reg.name || "") + '》' + badge + '</div>' +
                '<div class="reg-item-code">' + escapeHtml(reg.code || "") + '</div>' +
                '<div class="reg-item-meta">' +
                    '<span>分类：' + escapeHtml(reg.category || '未分类') + '</span>' +
                    '<span>实施日期：' + escapeHtml(reg.implement_date || '—') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="reg-item-actions">' +
                '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();editRegulation(' + reg.id + ')" title="编辑">✏️</button>' +
                '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();deleteRegulation(' + reg.id + ',\'' + escapeHtml(reg.full_name || reg.name || '').replace(/'/g, "\\'") + '\')" title="删除">🗑️</button>' +
            '</div>' +
        '</div>';
    });

    div.innerHTML = html;
    updateBatchBar();
}

function onRegSelectChange() {
    updateBatchBar();
}

function updateBatchBar() {
    var checked = document.querySelectorAll(".reg-select-cb:checked");
    var bar = document.getElementById("batchActionBar");
    var countSpan = document.getElementById("batchSelectedCount");
    if (checked.length > 0) {
        bar.style.display = "flex";
        countSpan.textContent = checked.length;
    } else {
        bar.style.display = "none";
    }
}

function selectAllRegulations() {
    var cbs = document.querySelectorAll(".reg-select-cb");
    var allChecked = Array.from(cbs).every(function(cb){return cb.checked;});
    cbs.forEach(function(cb){cb.checked = !allChecked;});
    updateBatchBar();
}

function batchDeleteRegulations() {
    var checked = document.querySelectorAll(".reg-select-cb:checked");
    var ids = Array.from(checked).map(function(cb){return parseInt(cb.value);});
    if (ids.length === 0) {
        showToast("请先选择要删除的规范", "info");
        return;
    }
    if (!confirm("确定要批量删除选中的 " + ids.length + " 部规章制度吗？\n此操作不可撤销！")) {
        return;
    }
    fetch("/api/regulations/batch_delete", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ids: ids})
    })
        .then(function(r){return r.json();})
        .then(function(data){
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast(data.message, "success");
                loadRegulations();
            }
        })
        .catch(function(){
            showToast("批量删除失败", "error");
        });
}

function searchRegulations() {
    var keyword = document.getElementById("regSearchInput").value.trim().toLowerCase();
    var items = document.querySelectorAll(".regulation-item");

    items.forEach(function (item) {
        var text = item.textContent.toLowerCase();
        if (text.indexOf(keyword) >= 0 || !keyword) {
            item.style.display = "";
        } else {
            item.style.display = "none";
        }
    });
}

// ===== 删除/编辑规章制度 =====
function deleteRegulation(id, name) {
    if (!confirm("确定要删除《" + name + "》及其所有条款吗？\n此操作不可撤销！")) {
        return;
    }
    fetch("/api/regulations/" + id, {
        method: "DELETE"
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast("已删除《" + name + "》", "success");
                loadRegulations();
            }
        })
        .catch(function () {
            showToast("删除失败", "error");
        });
}

function deleteClause(regId, clauseId) {
    if (!confirm("确定要删除这条条款吗？")) {
        return;
    }
    fetch("/api/regulations/" + regId + "/clauses/" + clauseId, {
        method: "DELETE"
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast("条款已删除", "success");
                showRegDetail(regId); // 刷新详情
                loadRegulations();
            }
        })
        .catch(function () {
            showToast("删除失败", "error");
        });
}

function editRegulation(id) {
    fetch("/api/regulations/" + id)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var reg = data.regulation;
            var clauses = data.clauses;

            var clausesText = clauses.map(function (c) {
                var kws = c.keywords ? c.keywords.split(",").filter(function(k){return k.trim();}).join(",") : "";
                return c.clause_number + "|" + c.clause_content + "|" + kws;
            }).join("\n");

            var html = '<div class="form-group">' +
                '<label>规范名称 <span class="required">*</span></label>' +
                '<input type="text" id="editRegName" class="form-control" value="' + escapeHtml(reg.full_name || reg.name || "") + '">' +
                '</div>' +
                '<div class="form-row">' +
                    '<div class="form-group" style="flex:1">' +
                        '<label>规范编号 <span class="required">*</span></label>' +
                        '<input type="text" id="editRegCode" class="form-control" value="' + escapeHtml(reg.code || "") + '">' +
                    '</div>' +
                    '<div class="form-group" style="flex:1">' +
                        '<label>分类</label>' +
                        '<select id="editRegCategory" class="form-control">' +
                            ['消防防火','消防给水','消防电气','防烟排烟','疏散设施','建筑电气','结构安全','给排水','建筑节能'].map(function(cat) {
                                return '<option value="' + cat + '"' + (reg.category === cat ? ' selected' : '') + '>' + cat + '</option>';
                            }).join('') +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div class="form-row">' +
                    '<div class="form-group" style="flex:1">' +
                        '<label>发布日期</label>' +
                        '<input type="date" id="editRegPublish" class="form-control" value="' + (reg.publish_date || "") + '">' +
                    '</div>' +
                    '<div class="form-group" style="flex:1">' +
                        '<label>实施日期</label>' +
                        '<input type="date" id="editRegImplement" class="form-control" value="' + (reg.implement_date || "") + '">' +
                    '</div>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>规范简介</label>' +
                    '<textarea id="editRegDesc" class="form-control" rows="2">' + escapeHtml(reg.description || "") + '</textarea>' +
                '</div>' +
                '<div class="modal-footer">' +
                    '<button class="btn btn-outline" onclick="closeModal(\'addModal\')">取消</button>' +
                    '<button class="btn btn-primary" onclick="submitEditRegulation(' + id + ')">💾 保存修改</button>' +
                '</div>';

            document.getElementById("addModalBody").innerHTML = html;
            document.getElementById("addModal").style.display = "flex";
        })
        .catch(function () {
            showToast("加载规范信息失败", "error");
        });
}

function submitEditRegulation(id) {
    var data = {
        name: document.getElementById("editRegName").value.trim(),
        code: document.getElementById("editRegCode").value.trim(),
        full_name: document.getElementById("editRegName").value.trim(),
        category: document.getElementById("editRegCategory").value,
        publish_date: document.getElementById("editRegPublish").value,
        implement_date: document.getElementById("editRegImplement").value,
        description: document.getElementById("editRegDesc").value.trim()
    };

    if (!data.name || !data.code) {
        showToast("请填写规范名称和编号", "error");
        return;
    }

    fetch("/api/regulations/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (result.error) {
                showToast(result.error, "error");
            } else {
                showToast("修改已保存", "success");
                closeModal("addModal");
                loadRegulations();
            }
        })
        .catch(function () {
            showToast("保存失败", "error");
        });
}

function showRegDetail(id) {
    fetch("/api/regulations/" + id)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var reg = data.regulation;
            var clauses = data.clauses;

            document.getElementById("modalRegName").textContent =
                "《" + reg.full_name + "》" + reg.code;

            var html = '<div style="margin-bottom:16px">' +
                '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
                    '<span class="reg-item-badge ' + (reg.is_mandatory ? 'badge-mandatory' : 'badge-normal') + '">' +
                        (reg.is_mandatory ? '强制性标准' : '推荐性标准') + '</span>' +
                    '<span class="reg-item-badge badge-normal">分类：' + (reg.category || '未分类') + '</span>' +
                '</div>' +
                '<div style="font-size:13px;color:#6b7280;margin-bottom:4px">' +
                    '发布日期：' + (reg.publish_date || '—') + '　' +
                    '实施日期：' + (reg.implement_date || '—') +
                '</div>';

            if (reg.description) {
                html += '<div style="font-size:13px;color:#4b5563;margin-top:8px;padding:10px;background:#f9fafb;border-radius:6px">' +
                    reg.description + '</div>';
            }

            html += '<h4 style="margin:20px 0 12px;font-size:15px">条款列表（共' + clauses.length + '条）</h4>';

            clauses.forEach(function (c) {
                html += '<div class="clause-detail">' +
                    '<div class="clause-detail-num">第 ' + c.clause_number + ' 条' +
                        (c.is_mandatory ? ' <span class="mandatory-badge">强条</span>' : '') +
                        ' <button class="btn btn-xs btn-outline" style="margin-left:8px;padding:2px 8px;font-size:11px" onclick="deleteClause(' + reg.id + ',' + c.id + ')" title="删除此条款">🗑️</button>' +
                    '</div>' +
                    '<div class="clause-detail-content">' + c.clause_content + '</div>';

                if (c.keywords) {
                    var kws = c.keywords.split(",").filter(function(k){return k.trim();});
                    if (kws.length > 0) {
                        html += '<div class="clause-detail-keywords">';
                        kws.forEach(function (kw) {
                            html += '<span class="keyword-tag">' + kw.trim() + '</span>';
                        });
                        html += '</div>';
                    }
                }

                html += '</div>';
            });

            document.getElementById("modalRegBody").innerHTML = html;
            document.getElementById("regDetailModal").style.display = "flex";
        })
        .catch(function () {
            showToast("加载详情失败", "error");
        });
}

// ===== 导入规范 =====
function showImportModal() {
    document.getElementById("importTextarea").value = "";
    document.getElementById("importModal").style.display = "flex";
}

function importRegulations() {
    var text = document.getElementById("importTextarea").value.trim();
    if (!text) {
        showToast("请粘贴JSON数据", "error");
        return;
    }

    try {
        var data = JSON.parse(text);
    } catch (e) {
        showToast("JSON格式错误：" + e.message, "error");
        return;
    }

    fetch("/api/regulations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (result.error) {
                showToast(result.error, "error");
            } else {
                showToast(result.message, "success");
                closeModal("importModal");
                loadRegulations();
            }
        })
        .catch(function () {
            showToast("导入失败", "error");
        });
}

function downloadTemplate() {
    fetch("/api/export/template")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var blob = new Blob([JSON.stringify(data, null, 2)],
                { type: "application/json;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = "规章制度导入模板.json";
            a.click();
            URL.revokeObjectURL(url);
            showToast("模板已下载", "success");
        });
}

// ===== 添加规范 =====
function showAddModal() {
    var html = '<div class="form-group">' +
        '<label>规范名称 <span class="required">*</span></label>' +
        '<input type="text" id="addRegName" class="form-control" placeholder="如：建筑防火通用规范">' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group" style="flex:1">' +
                '<label>规范编号 <span class="required">*</span></label>' +
                '<input type="text" id="addRegCode" class="form-control" placeholder="如：GB 55037-2022">' +
            '</div>' +
            '<div class="form-group" style="flex:1">' +
                '<label>分类</label>' +
                '<select id="addRegCategory" class="form-control">' +
                    '<option value="消防防火">消防防火</option>' +
                    '<option value="消防给水">消防给水</option>' +
                    '<option value="消防电气">消防电气</option>' +
                    '<option value="防烟排烟">防烟排烟</option>' +
                    '<option value="疏散设施">疏散设施</option>' +
                    '<option value="建筑电气">建筑电气</option>' +
                    '<option value="结构安全">结构安全</option>' +
                    '<option value="给排水">给排水</option>' +
                    '<option value="建筑节能">建筑节能</option>' +
                '</select>' +
            '</div>' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group" style="flex:1">' +
                '<label>发布日期</label>' +
                '<input type="date" id="addRegPublish" class="form-control">' +
            '</div>' +
            '<div class="form-group" style="flex:1">' +
                '<label>实施日期</label>' +
                '<input type="date" id="addRegImplement" class="form-control">' +
            '</div>' +
        '</div>' +
        '<div class="form-group">' +
            '<label>是否强制性标准</label>' +
            '<select id="addRegMandatory" class="form-control">' +
                '<option value="true">是</option>' +
                '<option value="false" selected>否</option>' +
            '</select>' +
        '</div>' +
        '<div class="form-group">' +
            '<label>规范简介</label>' +
            '<textarea id="addRegDesc" class="form-control" rows="3" placeholder="规范的适用范围和内容简介"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
            '<label>条款（每行一条，格式：条款号|条款内容|关键词1,关键词2）</label>' +
            '<textarea id="addRegClauses" class="form-control" rows="5" ' +
                'placeholder="6.3.4|管线穿越防火隔墙时应采用防火封堵材料封堵|管线穿越,防火隔墙,孔洞,防火封堵"></textarea>' +
        '</div>' +
        '<div class="modal-footer">' +
            '<button class="btn btn-outline" onclick="closeModal(\'addModal\')">取消</button>' +
            '<button class="btn btn-primary" onclick="submitAddRegulation()">确认添加</button>' +
        '</div>';

    document.getElementById("addModalBody").innerHTML = html;
    document.getElementById("addModal").style.display = "flex";
}

function submitAddRegulation() {
    var name = document.getElementById("addRegName").value.trim();
    var code = document.getElementById("addRegCode").value.trim();

    if (!name || !code) {
        showToast("请填写规范名称和编号", "error");
        return;
    }

    var clauses = [];
    var clauseText = document.getElementById("addRegClauses").value.trim();
    if (clauseText) {
        var lines = clauseText.split("\n");
        lines.forEach(function (line) {
            var parts = line.split("|");
            if (parts.length >= 2) {
                var clauseNum = parts[0].trim();
                var clauseContent = parts[1].trim();
                var keywords = parts[2] ? parts[2].split(",").map(function(k){return k.trim();}) : [];
                clauses.push({
                    clause_number: clauseNum,
                    clause_content: clauseContent,
                    keywords: keywords
                });
            }
        });
    }

    var data = {
        name: name,
        code: code,
        full_name: name,
        category: document.getElementById("addRegCategory").value,
        publish_date: document.getElementById("addRegPublish").value,
        implement_date: document.getElementById("addRegImplement").value,
        is_mandatory: document.getElementById("addRegMandatory").value === "true",
        description: document.getElementById("addRegDesc").value.trim(),
        clauses: clauses
    };

    fetch("/api/regulations/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (result.error) {
                showToast(result.error, "error");
            } else {
                showToast("添加成功", "success");
                closeModal("addModal");
                loadRegulations();
            }
        })
        .catch(function () {
            showToast("添加失败", "error");
        });
}

// ===== 在线搜索与PDF导入 =====
function switchSearchImportTab(tabName) {
    document.querySelectorAll(".search-import-tab").forEach(function (tab) {
        tab.classList.remove("active");
    });
    document.querySelectorAll(".search-import-content").forEach(function (c) {
        c.classList.remove("active");
    });

    // 找到对应的tab并激活
    var tabs = document.querySelectorAll(".search-import-tab");
    var contents = document.querySelectorAll(".search-import-content");
    var indexMap = { "web": 0, "pdf": 1, "manual": 2 };
    var idx = indexMap[tabName];
    if (tabs[idx]) tabs[idx].classList.add("active");
    if (contents[idx]) contents[idx].classList.add("active");
}

function searchWebRegulation() {
    var query = document.getElementById("webSearchInput").value.trim();
    if (!query) {
        showToast("请输入搜索关键词", "error");
        return;
    }

    var btn = document.getElementById("webSearchBtn");
    btn.disabled = true;
    btn.textContent = "搜索中...";
    document.getElementById("webSearchResults").innerHTML = '<div class="loading-state">正在搜索...</div>';
    document.getElementById("webSearchParsed").style.display = "none";

    fetch("/api/regulations/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query, max_results: 5 })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            btn.disabled = false;
            btn.textContent = "🔍 搜索";

            if (data.error) {
                document.getElementById("webSearchResults").innerHTML =
                    '<div class="empty-state"><p>' + data.error + '</p></div>';
                return;
            }

            var html = '<div style="font-size:13px;color:var(--chocolate-soft);margin-bottom:10px">' +
                escapeHtml(data.message || "") + '</div>';

            if (!data.results || data.results.length === 0) {
                html += '<div class="empty-state"><p>未找到搜索结果</p></div>';
                document.getElementById("webSearchResults").innerHTML = html;
                return;
            }

            data.results.forEach(function (r, idx) {
                var urlHtml = r.url ? '<div class="search-result-url">' + escapeHtml(r.url) + '</div>' : '';
                var fetchBtn = r.url
                    ? '<button class="btn btn-xs btn-cute" onclick="event.stopPropagation();fetchFullTextAndImport(' + idx + ')">📥 收录全文</button>'
                    : '';
                html += '<div class="search-result-item" onclick="selectWebSearchResult(' + idx + ')">' +
                    '<div class="search-result-title">' + escapeHtml(r.title || "") + '</div>' +
                    '<div class="search-result-snippet">' + escapeHtml(r.snippet || "") + '</div>' +
                    urlHtml +
                    '<div style="margin-top:6px">' + fetchBtn + '</div>' +
                    '</div>';
            });

            // 保存搜索结果供全文收录使用
            window._lastSearchResults = data.results;

            document.getElementById("webSearchResults").innerHTML = html;

            // 如果有LLM解析结果，直接显示
            if (data.regulation && data.regulation.name) {
                searchedRegulation = data.regulation;
                showParsedRegulation(data.regulation, "webSearchParsed", "webSearchParsedContent");
            }
        })
        .catch(function () {
            btn.disabled = false;
            btn.textContent = "🔍 搜索";
            showToast("搜索失败", "error");
        });
}

function selectWebSearchResult(idx) {
    // 可扩展：点击单条结果抓取详情
    showToast("已选择搜索结果，可在下方确认添加到库", "info");
}

function fetchFullTextAndImport(idx) {
    var results = window._lastSearchResults || [];
    var r = results[idx];
    if (!r || !r.url) {
        showToast("该结果没有可抓取的链接", "error");
        return;
    }

    var btn = event.target;
    btn.disabled = true;
    btn.textContent = "正在抓取全文...";

    fetch("/api/regulations/fetch_url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: r.url })
    })
        .then(function (resp) { return resp.json(); })
        .then(function (data) {
            btn.disabled = false;
            btn.textContent = "📥 收录全文";

            if (data.error) {
                showToast("抓取失败：" + data.error, "error");
                return;
            }

            if (data.regulation && data.regulation.name) {
                searchedRegulation = data.regulation;
                showParsedRegulation(data.regulation, "webSearchParsed", "webSearchParsedContent");

                // 显示全文长度信息
                var parsedDiv = document.getElementById("webSearchParsed");
                var infoDiv = document.createElement("div");
                infoDiv.className = "modal-hint";
                infoDiv.style.marginBottom = "10px";
                infoDiv.innerHTML = "📄 已抓取全文 " + (data.full_text_length || 0) + " 字符" +
                    (data.regulation.clauses ? "，解析出 " + data.regulation.clauses.length + " 条条款" : "");
                parsedDiv.insertBefore(infoDiv, parsedDiv.firstChild);

                showToast("全文抓取成功，已解析 " + (data.regulation.clauses ? data.regulation.clauses.length : 0) + " 条条款", "success");
            } else {
                showToast("抓取到文本但未能解析出规范信息，请尝试手动粘贴", "error");
                // 显示抓取到的文本供手动处理
                if (data.text) {
                    var resultsDiv = document.getElementById("webSearchResults");
                    var textDiv = document.createElement("div");
                    textDiv.className = "search-result-item";
                    textDiv.style.cursor = "default";
                    textDiv.innerHTML = '<div class="search-result-title">抓取到的文本（前3000字符）</div>' +
                        '<div class="search-result-snippet" style="max-height:200px;overflow-y:auto;white-space:pre-wrap">' +
                        escapeHtml(data.text) + '</div>';
                    resultsDiv.appendChild(textDiv);
                }
            }
        })
        .catch(function () {
            btn.disabled = false;
            btn.textContent = "📥 收录全文";
            showToast("抓取请求失败", "error");
        });
}

function showParsedRegulation(reg, containerId, contentId) {
    document.getElementById(containerId).style.display = "block";

    var html = '<div class="form-group"><label>规范名称</label><input type="text" class="form-control parsed-reg-name" value="' + escapeHtml(reg.name || "") + '"></div>' +
        '<div class="form-group"><label>规范编号</label><input type="text" class="form-control parsed-reg-code" value="' + escapeHtml(reg.code || "") + '"></div>' +
        '<div class="form-group"><label>分类</label><input type="text" class="form-control parsed-reg-category" value="' + escapeHtml(reg.category || "") + '"></div>' +
        '<div class="form-group"><label>规范简介</label><textarea class="form-control parsed-reg-desc" rows="2">' + escapeHtml(reg.description || "") + '</textarea></div>' +
        '<div class="form-group"><label>条款（已解析 ' + (reg.clauses ? reg.clauses.length : 0) + ' 条）</label>' +
        '<textarea class="form-control parsed-reg-clauses" rows="5">' + escapeHtml(formatClausesForEdit(reg.clauses)) + '</textarea></div>';

    document.getElementById(contentId).innerHTML = html;
}

function formatClausesForEdit(clauses) {
    if (!clauses || clauses.length === 0) return "";
    return clauses.map(function (c) {
        var kws = c.keywords ? c.keywords.join(",") : "";
        return (c.clause_number || "") + "|" + (c.clause_content || "") + "|" + kws;
    }).join("\n");
}

function parseClausesFromText(text) {
    var clauses = [];
    var lines = text.split("\n");
    lines.forEach(function (line) {
        var parts = line.split("|");
        if (parts.length >= 2) {
            var clauseNum = parts[0].trim();
            var clauseContent = parts[1].trim();
            var keywords = parts[2] ? parts[2].split(",").map(function(k){return k.trim();}).filter(Boolean) : [];
            if (clauseNum && clauseContent) {
                clauses.push({
                    clause_number: clauseNum,
                    clause_content: clauseContent,
                    keywords: keywords
                });
            }
        }
    });
    return clauses;
}

function addSearchedRegulation() {
    if (!searchedRegulation) {
        showToast("没有可添加的规范", "error");
        return;
    }
    addParsedRegulation("webSearchParsed", "webSearchParsedContent", function () {
        searchedRegulation = null;
        document.getElementById("webSearchParsed").style.display = "none";
        document.getElementById("webSearchResults").innerHTML = "";
        document.getElementById("webSearchInput").value = "";
    });
}

function addPdfRegulation() {
    if (!pdfRegulation) {
        showToast("没有可添加的规范", "error");
        return;
    }
    addParsedRegulation("pdfParsedResult", "pdfParsedContent", function () {
        pdfRegulation = null;
        document.getElementById("pdfParsedResult").style.display = "none";
        document.getElementById("pdfUploadStatus").innerHTML = "";
        document.getElementById("pdfFileInput").value = "";
    });
}

function addManualRegulation() {
    if (!manualRegulation) {
        showToast("没有可添加的规范", "error");
        return;
    }
    addParsedRegulation("manualParsedResult", "manualParsedContent", function () {
        manualRegulation = null;
        document.getElementById("manualParsedResult").style.display = "none";
        document.getElementById("manualRegText").value = "";
    });
}

function addParsedRegulation(containerId, contentId, onSuccess) {
    var container = document.getElementById(contentId);
    var name = container.querySelector(".parsed-reg-name").value.trim();
    var code = container.querySelector(".parsed-reg-code").value.trim();
    var category = container.querySelector(".parsed-reg-category").value.trim();
    var description = container.querySelector(".parsed-reg-desc").value.trim();
    var clausesText = container.querySelector(".parsed-reg-clauses").value.trim();

    if (!name || !code) {
        showToast("请至少填写规范名称和编号", "error");
        return;
    }

    var data = {
        name: name,
        code: code,
        full_name: name,
        category: category,
        description: description,
        is_mandatory: code.startsWith("GB ") && !code.startsWith("GB/T"),
        clauses: parseClausesFromText(clausesText)
    };

    fetch("/api/regulations/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (result.error) {
                showToast(result.error, "error");
            } else {
                showToast("规范已添加到库 ✨", "success");
                loadRegulations();
                onSuccess();
            }
        })
        .catch(function () {
            showToast("添加失败", "error");
        });
}

// PDF 拖拽上传
function handlePdfDrag(e) {
    e.preventDefault();
    e.currentTarget.classList.add("dragover");
}

function handlePdfDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
}

function handlePdfDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
    var files = e.dataTransfer.files;
    if (files.length > 0) {
        uploadPdfFile(files[0]);
    }
}

function handlePdfUpload(e) {
    var files = e.target.files;
    if (files.length > 0) {
        uploadPdfFile(files[0]);
    }
}

function onPdfModeChange() {
    var mode = document.querySelector('input[name="pdfMode"]:checked').value;
    var hint = document.getElementById("pdfUploadHint");
    if (mode === "deep") {
        hint.textContent = "AI深度解析：智能分块 → 逐块AI解析 → 合并全部条款，适合完整规范文档";
        hint.style.color = "#e88c78";
    } else {
        hint.textContent = "快速提取文本并规则匹配条款，适合快速预览";
        hint.style.color = "";
    }
}

// 当前PDF任务ID（用于终止）
let currentPdfTaskId = null;
let pdfPollTimer = null;

function uploadPdfFile(file) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
        showToast("仅支持PDF文件", "error");
        return;
    }

    var mode = document.querySelector('input[name="pdfMode"]:checked') 
        ? document.querySelector('input[name="pdfMode"]:checked').value : "normal";

    var statusDiv = document.getElementById("pdfUploadStatus");
    var progressDiv = document.getElementById("pdfProgress");
    var progressFill = document.getElementById("pdfProgressFill");
    var progressText = document.getElementById("pdfProgressText");
    var parsedDiv = document.getElementById("pdfParsedResult");

    statusDiv.innerHTML = "";
    parsedDiv.style.display = "none";
    progressDiv.style.display = "block";
    progressFill.style.width = "5%";
    progressText.textContent = "正在上传PDF文件...";

    // 显示终止按钮
    showPdfCancelButton(true);

    var formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);

    // 保存文件引用供OCR重试使用
    window._pendingPdfFile = file;

    fetch("/api/regulations/import/pdf", {
        method: "POST",
        body: formData,
        redirect: "follow"
    })
        .then(function (r) {
            if (!r.ok) {
                return r.text().then(function(text) {
                    throw new Error("HTTP " + r.status + ": " + (text.substring(0, 200) || r.statusText));
                });
            }
            return r.json();
        })
        .then(function (data) {
            if (data.error) {
                progressDiv.style.display = "none";
                showPdfCancelButton(false);
                statusDiv.innerHTML = '<div class="empty-state"><p>' + escapeHtml(data.error) + '</p></div>';
                return;
            }
            if (!data.task_id) {
                progressDiv.style.display = "none";
                showPdfCancelButton(false);
                statusDiv.innerHTML = '<div class="empty-state"><p>服务器未返回任务ID，请检查服务是否正常</p></div>';
                return;
            }
            // 收到task_id，开始轮询
            currentPdfTaskId = data.task_id;
            pollPdfTaskProgress(data.task_id, mode);
        })
        .catch(function (err) {
            progressDiv.style.display = "none";
            showPdfCancelButton(false);
            statusDiv.innerHTML = '<div class="empty-state"><p>PDF上传失败: ' + (err.message || '网络错误') + '</p></div>';
            showToast("PDF上传失败", "error");
        });
}

function pollPdfTaskProgress(taskId, mode) {
    var progressDiv = document.getElementById("pdfProgress");
    var progressFill = document.getElementById("pdfProgressFill");
    var progressText = document.getElementById("pdfProgressText");

    // 清除之前的定时器
    if (pdfPollTimer) clearTimeout(pdfPollTimer);

    var pollCount = 0;
    var maxPolls = 400; // 最多轮询400次（约5分钟，每800ms一次）

    function poll() {
        pollCount++;
        if (pollCount > maxPolls) {
            progressDiv.style.display = "none";
            showPdfCancelButton(false);
            document.getElementById("pdfUploadStatus").innerHTML =
                '<div class="empty-state"><p>解析超时，请尝试使用较小的PDF文件或检查服务器配置</p></div>';
            currentPdfTaskId = null;
            showToast("解析超时", "error");
            return;
        }

        fetch("/api/pdf/task/" + taskId, { redirect: "follow" })
            .then(function (r) {
                if (!r.ok) {
                    throw new Error("HTTP " + r.status);
                }
                return r.json();
            })
            .then(function (task) {
                if (task.error && !task.status) {
                    progressDiv.style.display = "none";
                    showPdfCancelButton(false);
                    document.getElementById("pdfUploadStatus").innerHTML =
                        '<div class="empty-state"><p>' + escapeHtml(task.error) + '</p></div>';
                    currentPdfTaskId = null;
                    return;
                }

                // 更新进度条
                progressFill.style.width = task.progress + "%";
                progressText.textContent = task.stage + " (" + task.progress + "%)" +
                    (task.elapsed ? " · 已用时" + task.elapsed + "s" : "");

                if (task.status === "completed") {
                    progressDiv.style.display = "none";
                    showPdfCancelButton(false);
                    currentPdfTaskId = null;
                    handlePdfTaskResult(task.result, mode);
                } else if (task.status === "failed") {
                    progressDiv.style.display = "none";
                    showPdfCancelButton(false);
                    currentPdfTaskId = null;
                    handlePdfTaskError(task);
                } else if (task.status === "cancelled") {
                    progressDiv.style.display = "none";
                    showPdfCancelButton(false);
                    currentPdfTaskId = null;
                    document.getElementById("pdfUploadStatus").innerHTML =
                        '<div class="empty-state"><p>🚫 解析已终止</p></div>';
                    showToast("解析已终止", "info");
                } else {
                    // pending / running，继续轮询
                    pdfPollTimer = setTimeout(poll, 800);
                }
            })
            .catch(function () {
                progressDiv.style.display = "none";
                showPdfCancelButton(false);
                currentPdfTaskId = null;
                document.getElementById("pdfUploadStatus").innerHTML =
                    '<div class="empty-state"><p>进度查询失败</p></div>';
            });
    }

    poll();
}

function showPdfCancelButton(show) {
    var progressDiv = document.getElementById("pdfProgress");
    // 检查是否已存在终止按钮
    var existingBtn = document.getElementById("pdfCancelBtn");
    if (existingBtn) existingBtn.remove();

    if (show) {
        var btn = document.createElement("button");
        btn.id = "pdfCancelBtn";
        btn.className = "btn btn-sm btn-danger";
        btn.style.marginTop = "8px";
        btn.style.display = "block";
        btn.style.marginLeft = "auto";
        btn.style.marginRight = "auto";
        btn.innerHTML = "🚫 终止解析";
        btn.onclick = function() { cancelPdfTask(); };
        progressDiv.appendChild(btn);
    }
}

function cancelPdfTask() {
    if (!currentPdfTaskId) {
        showToast("没有正在进行的解析任务", "info");
        return;
    }
    fetch("/api/pdf/task/" + currentPdfTaskId + "/cancel", {
        method: "POST"
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast("正在终止解析...", "info");
                if (pdfPollTimer) clearTimeout(pdfPollTimer);
            }
        })
        .catch(function () {
            showToast("终止请求失败", "error");
        });
}

function handlePdfTaskResult(result, mode) {
    if (!result) {
        document.getElementById("pdfUploadStatus").innerHTML =
            '<div class="empty-state"><p>解析结果为空</p></div>';
        return;
    }

    // 检查是否需要OCR
    if (result.need_ocr) {
        var statusDiv = document.getElementById("pdfUploadStatus");
        statusDiv.innerHTML =
            '<div class="modal-hint" style="color:#e67e22">⚠️ 该PDF为扫描版，需要OCR识别</div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="btn btn-primary" onclick="retryPdfWithOCR()">🔍 使用OCR识别</button>' +
                '<button class="btn btn-outline" onclick="retryPdfWithOCRDeep()">🔍 OCR + AI深度解析</button>' +
            '</div>';
        return;
    }

    var data = result;
    var statusDiv = document.getElementById("pdfUploadStatus");

    var engineLabel = data.engine ? "（引擎: " + data.engine + "）" : "";
    var warningHtml = data.warning
        ? '<div class="modal-hint" style="color:#e67e22;margin-top:8px">⚠️ ' + data.warning + '</div>' : "";
    var warningsHtml = "";
    if (data.warnings && data.warnings.length > 0) {
        warningsHtml = '<div class="modal-hint" style="color:#999;margin-top:8px;font-size:11px">' +
            '部分分块解析出现问题（不影响主要结果）：<br>' +
            data.warnings.map(function(w){return "• " + w;}).join("<br>") + '</div>';
    }

    var statsHtml = "";
    if (mode === "deep" || data.clauses_count !== undefined) {
        statsHtml = '<div class="pdf-deep-stats">' +
            '<div class="pdf-deep-stat"><div class="pdf-deep-stat-value">' + (data.pages || 0) + '</div><div class="pdf-deep-stat-label">页数</div></div>' +
            '<div class="pdf-deep-stat"><div class="pdf-deep-stat-value">' + (data.full_text_length || 0) + '</div><div class="pdf-deep-stat-label">提取字符</div></div>' +
            (data.chunks ? '<div class="pdf-deep-stat"><div class="pdf-deep-stat-value">' + data.chunks + '</div><div class="pdf-deep-stat-label">分块数</div></div>' : '') +
            '<div class="pdf-deep-stat" style="background:var(--rose-soft);border-color:var(--rose)"><div class="pdf-deep-stat-value">' + (data.clauses_count || 0) + '</div><div class="pdf-deep-stat-label">提取条款</div></div>' +
            '</div>';
    }

    statusDiv.innerHTML = '<div class="modal-hint">📑 ' + (data.message || "解析完成") + engineLabel + '</div>' + warningHtml + warningsHtml + statsHtml;

    if (data.regulation && data.regulation.name) {
        pdfRegulation = data.regulation;
        showParsedRegulation(data.regulation, "pdfParsedResult", "pdfParsedContent");
        var hint = document.getElementById("pdfParsedHint");
        if (data.regulation.clauses && data.regulation.clauses.length > 0) {
            hint.innerHTML = '💡 已解析出 <b>' + data.regulation.clauses.length + '</b> 条条款，确认无误后点击"全部收录到库"';
        }
    } else {
        statusDiv.innerHTML += '<div class="empty-state"><p>未能识别出规范信息，请尝试手动粘贴文本</p></div>';
    }
}

function handlePdfTaskError(task) {
    var statusDiv = document.getElementById("pdfUploadStatus");
    var errorHtml = '<div class="modal-hint" style="color:#e74c3c">❌ ' + (task.error || "解析失败") + '</div>';

    if (task.error && task.error.indexOf("OCR") >= 0) {
        errorHtml += '<div class="modal-hint" style="margin-top:8px">提示：OCR功能需要安装 tesseract-ocr 程序和 pytesseract 库。<br>' +
            '可从 <a href="https://github.com/UB-Mannheim/tesseract/wiki" target="_blank">tesseract下载页</a> 安装</div>';
    }

    statusDiv.innerHTML = errorHtml;
}

function retryPdfWithOCR() {
    _retryPdfWithOCRCore("ocr");
}

function retryPdfWithOCRDeep() {
    _retryPdfWithOCRCore("deep");
}

function _retryPdfWithOCRCore(mode) {
    var file = window._pendingPdfFile;
    if (!file) {
        showToast("文件引用已失效，请重新选择PDF", "error");
        return;
    }
    // 复用uploadPdfFile，但强制use_ocr
    var modeInput = document.querySelector('input[name="pdfMode"][value="' + (mode === "deep" ? "deep" : "normal") + '"]');
    if (modeInput) modeInput.checked = true;

    // 创建新的FormData带use_ocr
    var statusDiv = document.getElementById("pdfUploadStatus");
    var progressDiv = document.getElementById("pdfProgress");
    var progressFill = document.getElementById("pdfProgressFill");
    var progressText = document.getElementById("pdfProgressText");

    statusDiv.innerHTML = "";
    document.getElementById("pdfParsedResult").style.display = "none";
    progressDiv.style.display = "block";
    progressFill.style.width = "5%";
    progressText.textContent = "正在上传PDF（OCR模式）...";
    showPdfCancelButton(true);

    var formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);
    formData.append("use_ocr", "true");

    fetch("/api/regulations/import/pdf", {
        method: "POST",
        body: formData
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                progressDiv.style.display = "none";
                showPdfCancelButton(false);
                statusDiv.innerHTML = '<div class="empty-state"><p>' + data.error + '</p></div>';
                return;
            }
            currentPdfTaskId = data.task_id;
            pollPdfTaskProgress(data.task_id, mode);
        })
        .catch(function () {
            progressDiv.style.display = "none";
            showPdfCancelButton(false);
            statusDiv.innerHTML = '<div class="empty-state"><p>OCR上传失败</p></div>';
            showToast("OCR上传失败", "error");
        });
}

function len(s) { return s ? s.length : 0; }

function parseManualRegulation() {
    var text = document.getElementById("manualRegText").value.trim();
    if (!text) {
        showToast("请先粘贴规范文本", "error");
        return;
    }

    var btn = document.getElementById("manualParseBtn");
    btn.disabled = true;
    btn.textContent = "AI解析中...";

    fetch("/api/regulations/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, max_results: 1 })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            btn.disabled = false;
            btn.textContent = "🔮 AI解析";

            if (data.error) {
                showToast(data.error, "error");
                return;
            }

            if (data.regulation && data.regulation.name) {
                manualRegulation = data.regulation;
                showParsedRegulation(data.regulation, "manualParsedResult", "manualParsedContent");
            } else {
                showToast("未能解析出规范信息", "error");
            }
        })
        .catch(function () {
            btn.disabled = false;
            btn.textContent = "🔮 AI解析";
            showToast("解析失败", "error");
        });
}

// ===== 通知书生成 =====
function addProblemRow() {
    problemCounter++;
    var list = document.getElementById("problemList");
    document.getElementById("problemListEmpty").style.display = "none";

    var div = document.createElement("div");
    div.className = "problem-row";
    div.id = "problemRow_" + problemCounter;
    div.dataset.matches = "[]";
    div.innerHTML =
        '<div class="problem-row-header">' +
            '<span class="problem-row-num">问题 ' + problemCounter + '</span>' +
            '<button class="btn btn-xs btn-outline" onclick="removeProblemRow(' + problemCounter + ')">删除</button>' +
        '</div>' +
        '<textarea class="form-control" placeholder="输入现场发现的问题描述..." rows="2"></textarea>' +
        '<div class="problem-match-result" id="problemMatch_' + problemCounter + '" style="display:none"></div>';

    list.appendChild(div);
}

function removeProblemRow(id) {
    document.getElementById("problemRow_" + id).remove();
    if (document.querySelectorAll(".problem-row").length === 0) {
        document.getElementById("problemListEmpty").style.display = "";
    }
}

function collectNoticeProblems() {
    var problems = [];
    document.querySelectorAll(".problem-row").forEach(function (row) {
        var textarea = row.querySelector("textarea");
        if (textarea && textarea.value.trim()) {
            var matches = [];
            try {
                matches = JSON.parse(row.dataset.matches || "[]");
            } catch (e) {
                matches = [];
            }
            problems.push({
                description: textarea.value.trim(),
                matches: matches,
            });
        }
    });
    return problems;
}

function getProjectInfo() {
    return {
        project_name: document.getElementById("projectName").value.trim(),
        supervision_no: document.getElementById("supervisionNo").value.trim(),
        inspection_date: document.getElementById("inspectionDate").value,
        construction_unit: document.getElementById("constructionUnit").value.trim(),
        supervision_unit: document.getElementById("supervisionUnit").value.trim(),
        construction_company: document.getElementById("constructionCompany").value.trim()
    };
}

function generateNotice() {
    var projectInfo = getProjectInfo();
    var problems = collectNoticeProblems();

    if (!projectInfo.project_name) {
        showToast("请填写工程名称", "error");
        return;
    }

    if (problems.length === 0) {
        showToast("请至少添加一个问题", "error");
        return;
    }

    // 未配置LLM时直接生成
    if (!isAIReady()) {
        doGenerateNotice(projectInfo, problems, true);
        return;
    }

    // 配置LLM时，先打开复核弹窗
    document.getElementById("aiReviewModal").style.display = "flex";
    document.getElementById("aiReviewActions").style.display = "none";
    document.getElementById("aiReviewContent").innerHTML = '<div class="loading-state">AI正在复核中...</div>';

    fetch("/api/notice/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            project_info: projectInfo,
            problems: problems
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            pendingReviewData = data;
            renderReviewResult(data);
        })
        .catch(function () {
            document.getElementById("aiReviewContent").innerHTML =
                '<div class="empty-state"><div class="empty-icon">⚠️</div><p>复核请求失败</p></div>';
            document.getElementById("aiReviewActions").style.display = "flex";
        });
}

function renderReviewResult(data) {
    var container = document.getElementById("aiReviewContent");
    var panelClass = data.pass ? "" : "warning";

    var html = '<div class="review-result-panel ' + panelClass + '">';
    html += '<div class="review-header">';
    if (data.pass) {
        html += '<span class="review-title">✅ 复核通过</span>';
    } else {
        html += '<span class="review-title">⚠️ 复核发现建议</span>';
    }
    html += '</div>';

    var items = data.items || [];
    items.forEach(function (item) {
        var idx = item.problem_index || 1;
        html += '<div class="review-item">' +
            '<div class="review-item-problem">' + idx + '. ' + escapeHtml(item.problem || "") + '</div>';

        var corrIcon = item.correctness_pass ? '<span class="review-check-icon ok">✓</span>' : '<span class="review-check-icon warn">!</span>';
        html += '<div class="review-check">' + corrIcon + '<div><b>问题-条款对应：</b>' + escapeHtml(item.correctness_comment || "") + '</div></div>';

        var typoIcon = item.typo_pass ? '<span class="review-check-icon ok">✓</span>' : '<span class="review-check-icon warn">!</span>';
        html += '<div class="review-check">' + typoIcon + '<div><b>Typo检查：</b>' + escapeHtml(item.typo_comment || "") + '</div></div>';

        if (item.corrected_problem && item.corrected_problem !== item.problem) {
            html += '<div class="review-check" style="margin-top:8px;padding:8px;background:var(--cream);border-radius:var(--radius)">' +
                '<span class="review-check-icon ok">✏️</span>' +
                '<div><b>AI建议修正：</b>' + escapeHtml(item.corrected_problem) + '</div></div>';
        }

        html += '</div>';
    });

    html += '<div class="review-summary">' + escapeHtml(data.summary || "") + '</div>';
    html += '</div>';

    container.innerHTML = html;
    document.getElementById("aiReviewActions").style.display = "flex";
}

function confirmGenerateAfterReview() {
    var projectInfo = getProjectInfo();
    var problems = collectNoticeProblems();

    // 应用AI修正
    if (pendingReviewData && pendingReviewData.items) {
        pendingReviewData.items.forEach(function (item, idx) {
            if (item.corrected_problem && item.corrected_problem !== item.problem && problems[idx]) {
                problems[idx].corrected_description = item.corrected_problem;
                problems[idx].description = item.corrected_problem;

                // 同步更新前端textarea
                var rows = document.querySelectorAll(".problem-row");
                if (rows[idx]) {
                    var ta = rows[idx].querySelector("textarea");
                    if (ta) ta.value = item.corrected_problem;
                }
            }
        });
    }

    closeModal("aiReviewModal");
    doGenerateNotice(projectInfo, problems, false);
}

function doGenerateNotice(projectInfo, problems, skipReview) {
    var btn = document.getElementById("generateBtn");
    btn.disabled = true;
    btn.textContent = "生成中...";

    fetch("/api/notice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            project_info: projectInfo,
            problems: problems,
            skip_review: skipReview
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
                btn.disabled = false;
                btn.textContent = "✨ 生成通知书";
                return;
            }

            noticeTextCache = data.notice_text;

            // 显示预览
            var preview = document.getElementById("noticePreview");
            preview.innerHTML = '<div class="notice-preview"><div class="notice-content">' +
                escapeHtml(data.notice_text) + '</div></div>';

            // 更新问题行的匹配结果
            data.problems.forEach(function (prob, idx) {
                var rows = document.querySelectorAll(".problem-row");
                if (rows[idx]) {
                    var resultDiv = rows[idx].querySelector(".problem-match-result");
                    if (resultDiv && prob.matches && prob.matches.length > 0) {
                        var refs = prob.matches.map(function (m) {
                            return '<span class="matched-ref">《' + m.regulation_full_name + '》' +
                                m.regulation_code + ' 第' + m.clause_number + '条</span>';
                        }).join("、");
                        resultDiv.innerHTML = "匹配规范：" + refs;
                        resultDiv.style.display = "block";
                    }
                    // 同步修正后的matches到dataset
                    rows[idx].dataset.matches = JSON.stringify(prob.matches || []);
                }
            });

            // 显示操作按钮
            document.getElementById("copyBtn").style.display = "";
            document.getElementById("exportWordBtn").style.display = "";
            document.getElementById("exportPdfBtn").style.display = "";
            if (isAIReady()) {
                document.getElementById("polishBtn").style.display = "";
            }

            btn.disabled = false;
            btn.textContent = "✨ 重新生成";
            showToast("通知书已生成 ✨", "success");
        })
        .catch(function () {
            showToast("生成失败", "error");
            btn.disabled = false;
            btn.textContent = "✨ 生成通知书";
        });
}

function copyNotice() {
    if (!noticeTextCache) return;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(noticeTextCache).then(function () {
            showToast("已复制到剪贴板", "success");
        });
    } else {
        var textarea = document.createElement("textarea");
        textarea.value = noticeTextCache;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        showToast("已复制到剪贴板", "success");
    }
}

function downloadNotice() {
    if (!noticeTextCache) return;

    var blob = new Blob(["\uFEFF" + noticeTextCache],
        { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "整改通知书_" +
        new Date().toISOString().split("T")[0] + ".txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("文件已下载", "success");
}

function exportNotice(format) {
    if (!noticeTextCache) {
        showToast("请先生成通知书", "error");
        return;
    }

    var projectInfo = collectProjectInfo();
    var endpoint = format === "word" ? "/api/notice/export/word" : "/api/notice/export/pdf";

    showToast("正在生成" + (format === "word" ? "Word" : "PDF") + "文件...", "info");

    fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            notice_text: noticeTextCache,
            project_info: projectInfo
        })
    })
        .then(function(resp) {
            if (!resp.ok) {
                return resp.json().then(function(err) {
                    throw new Error(err.error || "导出失败");
                });
            }
            return resp.blob();
        })
        .then(function(blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            var ext = format === "word" ? "docx" : "pdf";
            var projectName = projectInfo.project_name || "未命名";
            projectName = projectName.substring(0, 20).replace(/[\\/:*?"<>|]/g, "_");
            a.download = "整改通知书_" + projectName + "." + ext;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast((format === "word" ? "Word" : "PDF") + "文件已下载", "success");
        })
        .catch(function(err) {
            showToast("导出失败: " + err.message, "error");
        });
}

function collectProjectInfo() {
    return {
        project_name: document.getElementById("projectName").value.trim(),
        supervision_no: document.getElementById("supervisionNo").value.trim(),
        inspection_date: document.getElementById("inspectionDate").value,
        construction_unit: document.getElementById("constructionUnit").value.trim(),
        supervision_unit: document.getElementById("supervisionUnit").value.trim(),
        construction_company: document.getElementById("constructionCompany").value.trim()
    };
}

// ===== 工具函数 =====
function closeModal(id) {
    document.getElementById(id).style.display = "none";
}

// ===== AI匹配结果渲染 =====
function renderAIResults(data) {
    var div = document.getElementById("matchResults");
    var countSpan = document.getElementById("resultCount");
    lastMatchResults = data;
    currentMatchResults = data.matches || [];

    var html = "";

    // AI分析
    if (data.analysis) {
        html += '<div class="ai-analysis-box">' +
            '<div class="ai-analysis-header"><span class="ai-badge">🤖 AI分析</span></div>' +
            '<div class="ai-analysis-content">' + escapeHtml(data.analysis) + '</div>' +
            '</div>';
    }

    if (!data.matches || data.matches.length === 0) {
        html += '<div class="empty-state">' +
            '<div class="empty-icon">📭</div>' +
            '<p>AI未找到匹配的规范条款</p>' +
            '</div>';
        countSpan.textContent = "";
        div.innerHTML = html;
        return;
    }

    countSpan.textContent = "AI匹配 " + data.total + " 条";

    data.matches.forEach(function (m, idx) {
        var mandatoryBadge = m.is_mandatory_reg
            ? '<span class="mandatory-badge">强制性标准</span>' : '';

        var relevanceBadge = "";
        if (m.ai_relevance) {
            var relClass = m.ai_relevance === "高" ? "high" : (m.ai_relevance === "中" ? "medium" : "low");
            relevanceBadge = '<span class="match-level-badge ' + relClass + '">AI: ' + m.ai_relevance + '</span>';
        }

        var keywordHtml = "";
        if (m.keywords && m.keywords.length > 0) {
            keywordHtml = '<div class="match-keywords">' +
                '<span class="match-keywords-label">关键词：</span>';
            m.keywords.forEach(function (kw) {
                if (kw.trim()) {
                    keywordHtml += '<span class="keyword-tag">' + kw.trim() + '</span>';
                }
            });
            keywordHtml += '</div>';
        }

        var reasonHtml = "";
        if (m.ai_reason) {
            reasonHtml = '<div class="ai-reason">💡 ' + escapeHtml(m.ai_reason) + '</div>';
        }

        html += '<div class="match-item">' +
            '<div class="match-item-header">' +
                '<div class="match-reg-info">' +
                    '<div class="match-reg-name">《' + m.regulation_full_name + '》' + mandatoryBadge + '</div>' +
                    '<div class="match-reg-code">' + m.regulation_code + '</div>' +
                    '<span class="match-clause-num">第 ' + m.clause_number + ' 条</span>' +
                '</div>' +
                '<div class="match-score">' + relevanceBadge + '</div>' +
            '</div>' +
            '<div class="match-clause-content">' + m.clause_content + '</div>' +
            keywordHtml +
            reasonHtml +
            '<div class="match-actions">' +
                '<button class="btn btn-xs btn-cute" onclick="addMatchToNotice(' + idx + ')">✨ 加入通知书</button>' +
            '</div>' +
        '</div>';
    });

    div.innerHTML = html;
}

function renderHybridResults(data) {
    var div = document.getElementById("matchResults");
    var countSpan = document.getElementById("resultCount");
    lastMatchResults = data;

    var html = '<div class="hybrid-banner">🔀 混合模式结果</div>';

    var keywordList = data.keyword_matches || [];
    var aiList = data.ai_matches || [];
    currentMatchResults = keywordList.concat(aiList);

    // 关键词匹配结果
    if (keywordList.length > 0) {
        html += '<div class="hybrid-section">' +
            '<div class="hybrid-section-title">关键词匹配 (' + data.keyword_total + '条)</div>';
        keywordList.forEach(function (m, idx) {
            html += renderMatchItemHtml(m, "keyword", idx);
        });
        html += '</div>';
    }

    // AI增强结果
    if (aiList.length > 0) {
        html += '<div class="hybrid-section">' +
            '<div class="hybrid-section-title">🤖 AI增强匹配 (' + data.ai_total + '条)</div>';

        if (data.ai_analysis) {
            html += '<div class="ai-analysis-box">' +
                '<div class="ai-analysis-content">' + escapeHtml(data.ai_analysis) + '</div>' +
                '</div>';
        }

        aiList.forEach(function (m, idx) {
            html += renderMatchItemHtml(m, "ai", keywordList.length + idx);
        });
        html += '</div>';
    } else if (data.ai_enabled) {
        html += '<div class="hybrid-section">' +
            '<div class="hybrid-section-title">🤖 AI增强匹配</div>' +
            '<p class="empty-hint">关键词匹配度已足够高，无需AI增强</p>' +
            '</div>';
    }

    countSpan.textContent = "混合匹配";
    div.innerHTML = html;
}

function renderMatchItemHtml(m, source, idx) {
    var levelClass = "";
    var levelText = "";
    if (source === "ai") {
        if (m.ai_relevance === "高") { levelClass = "high"; levelText = "AI: 高"; }
        else if (m.ai_relevance === "中") { levelClass = "medium"; levelText = "AI: 中"; }
        else { levelClass = "low"; levelText = "AI: 低"; }
    } else {
        if (m.match_level === "高") { levelClass = "high"; levelText = "高匹配"; }
        else if (m.match_level === "中") { levelClass = "medium"; levelText = "中匹配"; }
        else { levelClass = "low"; levelText = "低匹配"; }
    }

    var mandatoryBadge = m.is_mandatory_reg ? '<span class="mandatory-badge">强制性标准</span>' : '';
    var scoreDisplay = source === "ai"
        ? '<div class="match-level-badge ' + levelClass + '">' + levelText + '</div>'
        : '<div class="match-percentage ' + levelClass + '">' + m.match_percentage + '%</div>' +
          '<div class="match-level-badge ' + levelClass + '">' + levelText + '</div>';

    var reasonHtml = m.ai_reason
        ? '<div class="ai-reason">💡 ' + escapeHtml(m.ai_reason) + '</div>' : '';

    var keywordHtml = "";
    if (m.keywords && m.keywords.length > 0) {
        keywordHtml = '<div class="match-keywords"><span class="match-keywords-label">关键词：</span>';
        m.keywords.forEach(function (kw) {
            if (kw && kw.trim()) keywordHtml += '<span class="keyword-tag">' + kw.trim() + '</span>';
        });
        keywordHtml += '</div>';
    }

    var idxParam = (idx !== undefined) ? idx : -1;
    var addBtn = idxParam >= 0
        ? '<div class="match-actions"><button class="btn btn-xs btn-cute" onclick="addMatchToNotice(' + idxParam + ')">✨ 加入通知书</button></div>'
        : '';

    return '<div class="match-item">' +
        '<div class="match-item-header">' +
            '<div class="match-reg-info">' +
                '<div class="match-reg-name">《' + m.regulation_full_name + '》' + mandatoryBadge + '</div>' +
                '<div class="match-reg-code">' + m.regulation_code + '</div>' +
                '<span class="match-clause-num">第 ' + m.clause_number + ' 条</span>' +
            '</div>' +
            '<div class="match-score">' + scoreDisplay + '</div>' +
        '</div>' +
        '<div class="match-clause-content">' + m.clause_content + '</div>' +
        keywordHtml + reasonHtml + addBtn +
    '</div>';
}


// ===== LLM 配置管理 =====
function loadLLMProviders() {
    fetch("/api/llm/providers")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            llmProviders = data.providers;
            var select = document.getElementById("llmProviderSelect");
            select.innerHTML = '<option value="">-- 请选择 --</option>';
            Object.keys(llmProviders).forEach(function (key) {
                var p = llmProviders[key];
                select.innerHTML += '<option value="' + key + '">' + p.label + '</option>';
            });
        });
}

function loadLLMConfig() {
    fetch("/api/llm/config")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            llmConfig = data;
            updateLLMStatusUI(data);
        });
}

function updateLLMStatusUI(data) {
    var dot = document.getElementById("aiStatusDot");
    var dotHeader = document.getElementById("aiStatusDotHeader");
    var toggle = document.getElementById("llmEnabledToggle");
    var panel = document.getElementById("llmStatusPanel");

    var isReady = data.enabled && data.provider && data.api_key;

    if (isReady) {
        if (dot) dot.className = "ai-status-dot active";
        if (dotHeader) dotHeader.className = "ai-status-dot active";
        if (toggle) toggle.checked = true;
        var p = llmProviders[data.provider] || {};
        panel.innerHTML =
            '<div class="status-row"><span class="status-label">状态</span><span class="status-value status-active">已启用</span></div>' +
            '<div class="status-row"><span class="status-label">提供商</span><span class="status-value">' + (p.label || data.provider) + '</span></div>' +
            '<div class="status-row"><span class="status-label">模型</span><span class="status-value">' + (data.model || '—') + '</span></div>' +
            '<div class="status-row"><span class="status-label">API Key</span><span class="status-value">' + (data.api_key_masked || '—') + '</span></div>';
        var aiAnalyzeBtn = document.getElementById("aiAnalyzeBtn");
        if (aiAnalyzeBtn) aiAnalyzeBtn.style.display = "";
        var polishBtn = document.getElementById("polishBtn");
        if (polishBtn) polishBtn.style.display = "";
    } else {
        if (dot) dot.className = "ai-status-dot";
        if (dotHeader) dotHeader.className = "ai-status-dot";
        if (toggle) toggle.checked = false;
        panel.innerHTML =
            '<div class="status-row"><span class="status-label">状态</span><span class="status-value status-inactive">未启用</span></div>' +
            '<p class="empty-hint" style="margin-top:12px">请在左侧配置大模型提供商和API Key后启用</p>';
    }

    // 更新内联状态条
    updateAIInlineStatus(isReady, data);

    // 回填AI设置Tab表单
    if (data.provider) {
        document.getElementById("llmProviderSelect").value = data.provider;
        onProviderChange();
    }
    if (data.model) {
        document.getElementById("llmModelSelect").value = data.model;
    }
    if (data.temperature !== undefined) {
        document.getElementById("llmTemperature").value = data.temperature;
    }
    if (data.max_tokens) {
        document.getElementById("llmMaxTokens").value = data.max_tokens;
    }

    // 回填弹窗表单
    if (data.provider) {
        selectProviderInModal(data.provider, true);
    }
    if (data.model) {
        var modalModel = document.getElementById("modalModelSelect");
        if (modalModel) modalModel.value = data.model;
    }
    if (data.temperature !== undefined) {
        var modalTemp = document.getElementById("modalTemperature");
        if (modalTemp) modalTemp.value = data.temperature;
    }
    if (data.max_tokens) {
        var modalMaxTok = document.getElementById("modalMaxTokens");
        if (modalMaxTok) modalMaxTok.value = data.max_tokens;
    }
    if (data.api_key_masked) {
        var modalKey = document.getElementById("modalApiKey");
        if (modalKey && !modalKey.value) modalKey.placeholder = data.api_key_masked;
    }
    var modalToggle = document.getElementById("modalEnabledToggle");
    if (modalToggle) modalToggle.checked = isReady;
}

function updateAIInlineStatus(isReady, data) {
    var strip = document.getElementById("aiInlineStatus");
    var dot = document.getElementById("aiInlineDot");
    var text = document.getElementById("aiInlineText");
    if (!strip) return;

    if (isReady) {
        var p = llmProviders[data.provider] || {};
        strip.className = "ai-inline-status connected";
        dot.className = "ai-inline-dot";
        text.textContent = "AI已连接 · " + (p.label || data.provider) + " / " + (data.model || "");
    } else {
        strip.className = "ai-inline-status disconnected";
        dot.className = "ai-inline-dot";
        text.textContent = "AI未配置 · 选择AI模式需先配置API Key";
    }
}

function onProviderChange() {
    var provider = document.getElementById("llmProviderSelect").value;
    var modelSelect = document.getElementById("llmModelSelect");
    var infoDiv = document.getElementById("providerInfo");

    if (!provider || !llmProviders[provider]) {
        modelSelect.innerHTML = '<option value="">请先选择提供商</option>';
        infoDiv.style.display = "none";
        return;
    }

    var p = llmProviders[provider];
    modelSelect.innerHTML = "";
    p.models.forEach(function (m) {
        modelSelect.innerHTML += '<option value="' + m.id + '">' + m.label + '</option>';
    });
    modelSelect.value = p.default_model;

    infoDiv.style.display = "block";
    var docUrl = document.getElementById("providerDocUrl");
    docUrl.href = p.doc_url;
    document.getElementById("providerNote").textContent = p.note;
}

function saveLLMConfig() {
    var provider = document.getElementById("llmProviderSelect").value;
    var apiKey = document.getElementById("llmApiKey").value.trim();
    var model = document.getElementById("llmModelSelect").value;
    var temperature = parseFloat(document.getElementById("llmTemperature").value) || 0.3;
    var maxTokens = parseInt(document.getElementById("llmMaxTokens").value) || 2048;

    if (!provider) {
        showToast("请选择提供商", "error");
        return;
    }

    // 如果没输入新key，保留已有key
    if (!apiKey && llmConfig.api_key) {
        apiKey = llmConfig.api_key;
    }
    if (!apiKey) {
        showToast("请输入API Key", "error");
        return;
    }

    fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider: provider,
            api_key: apiKey,
            model: model,
            temperature: temperature,
            max_tokens: maxTokens,
            enabled: true
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast("配置已保存", "success");
                loadLLMConfig();
            }
        });
}

function testLLMConnection() {
    var provider = document.getElementById("llmProviderSelect").value;
    var apiKey = document.getElementById("llmApiKey").value.trim();
    var model = document.getElementById("llmModelSelect").value;

    if (!provider) {
        showToast("请选择提供商", "error");
        return;
    }
    if (!apiKey && !llmConfig.api_key) {
        showToast("请输入API Key", "error");
        return;
    }

    var btn = document.getElementById("testBtn");
    btn.disabled = true;
    btn.textContent = "测试中...";

    var resultDiv = document.getElementById("testResult");
    resultDiv.style.display = "block";
    resultDiv.className = "test-result testing";
    resultDiv.textContent = "正在连接 " + provider + " ...";

    fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider: provider,
            api_key: apiKey || llmConfig.api_key,
            model: model
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                resultDiv.className = "test-result success";
                resultDiv.textContent = "✓ " + data.message;
                showToast("连接成功", "success");
            } else {
                resultDiv.className = "test-result error";
                resultDiv.textContent = "✗ " + data.message;
                showToast("连接失败", "error");
            }
            btn.disabled = false;
            btn.textContent = "🔗 测试连接";
        })
        .catch(function () {
            resultDiv.className = "test-result error";
            resultDiv.textContent = "✗ 请求失败";
            btn.disabled = false;
            btn.textContent = "🔗 测试连接";
        });
}

function toggleLLM() {
    var enabled = document.getElementById("llmEnabledToggle").checked;
    fetch("/api/llm/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabled })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            showToast(data.message, "info");
            loadLLMConfig();
        });
}

// ===== 全局AI配置弹窗 =====
function isAIReady() {
    return llmConfig && llmConfig.enabled && llmConfig.provider && llmConfig.api_key;
}

function openAIConfigModal() {
    document.getElementById("aiConfigModal").style.display = "flex";
    // 回填当前配置
    if (llmConfig.provider) {
        selectProviderInModal(llmConfig.provider, true);
    }
    if (llmConfig.model) {
        var modelSelect = document.getElementById("modalModelSelect");
        if (modelSelect) modelSelect.value = llmConfig.model;
    }
    if (llmConfig.temperature !== undefined) {
        document.getElementById("modalTemperature").value = llmConfig.temperature;
    }
    if (llmConfig.max_tokens) {
        document.getElementById("modalMaxTokens").value = llmConfig.max_tokens;
    }
    if (llmConfig.api_key_masked) {
        var keyInput = document.getElementById("modalApiKey");
        keyInput.value = "";
        keyInput.placeholder = llmConfig.api_key_masked + " (已保存，如需修改请重新输入)";
    }
    var toggle = document.getElementById("modalEnabledToggle");
    toggle.checked = isAIReady();
    // 隐藏测试结果
    document.getElementById("modalTestResult").style.display = "none";
}

function closeAIConfigModal() {
    document.getElementById("aiConfigModal").style.display = "none";
}

function selectProviderInModal(provider, skipScroll) {
    // 更新卡片选中状态
    document.querySelectorAll(".provider-card").forEach(function (card) {
        if (card.getAttribute("data-provider") === provider) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });

    // 更新模型下拉
    var modelSelect = document.getElementById("modalModelSelect");
    var infoDiv = document.getElementById("modalProviderInfo");

    if (!provider || !llmProviders[provider]) {
        modelSelect.innerHTML = '<option value="">请先选择提供商</option>';
        infoDiv.style.display = "none";
        return;
    }

    var p = llmProviders[provider];
    modelSelect.innerHTML = "";
    p.models.forEach(function (m) {
        modelSelect.innerHTML += '<option value="' + m.id + '">' + m.label + '</option>';
    });
    modelSelect.value = p.default_model;

    infoDiv.style.display = "block";
    document.getElementById("modalProviderDocUrl").href = p.doc_url;
    document.getElementById("modalProviderNote").textContent = p.note;

    // 同步到AI设置Tab
    var tabProvider = document.getElementById("llmProviderSelect");
    if (tabProvider) tabProvider.value = provider;
    var tabModelSelect = document.getElementById("llmModelSelect");
    if (tabModelSelect) {
        tabModelSelect.innerHTML = "";
        p.models.forEach(function (m) {
            tabModelSelect.innerHTML += '<option value="' + m.id + '">' + m.label + '</option>';
        });
        tabModelSelect.value = p.default_model;
    }
    var tabInfo = document.getElementById("providerInfo");
    if (tabInfo) {
        tabInfo.style.display = "block";
        document.getElementById("providerDocUrl").href = p.doc_url;
        document.getElementById("providerNote").textContent = p.note;
    }
}

function toggleApiKeyVisibility() {
    var input = document.getElementById("modalApiKey");
    var eye = document.getElementById("apiKeyEye");
    if (input.type === "password") {
        input.type = "text";
        eye.textContent = "🙈";
    } else {
        input.type = "password";
        eye.textContent = "👁";
    }
}

function testLLMConnectionModal() {
    var provider = null;
    var selectedCard = document.querySelector(".provider-card.selected");
    if (selectedCard) {
        provider = selectedCard.getAttribute("data-provider");
    } else if (llmConfig.provider) {
        provider = llmConfig.provider;
    }

    var apiKey = document.getElementById("modalApiKey").value.trim();
    var model = document.getElementById("modalModelSelect").value;

    if (!provider) {
        showToast("请选择提供商", "error");
        return;
    }
    if (!apiKey && !llmConfig.api_key) {
        showToast("请输入API Key", "error");
        return;
    }

    var btn = document.getElementById("modalTestBtn");
    btn.disabled = true;
    btn.textContent = "测试中...";

    var resultDiv = document.getElementById("modalTestResult");
    resultDiv.style.display = "block";
    resultDiv.className = "test-result testing";
    resultDiv.textContent = "正在连接 " + (llmProviders[provider] ? llmProviders[provider].label : provider) + " ...";

    fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider: provider,
            api_key: apiKey || llmConfig.api_key,
            model: model
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                resultDiv.className = "test-result success";
                resultDiv.textContent = "✓ " + data.message;
                showToast("连接成功", "success");
            } else {
                resultDiv.className = "test-result error";
                resultDiv.textContent = "✗ " + data.message;
                showToast("连接失败", "error");
            }
            btn.disabled = false;
            btn.textContent = "🔗 测试连接";
        })
        .catch(function () {
            resultDiv.className = "test-result error";
            resultDiv.textContent = "✗ 请求失败，请检查网络";
            btn.disabled = false;
            btn.textContent = "🔗 测试连接";
        });
}

function saveLLMConfigModal() {
    var provider = null;
    var selectedCard = document.querySelector(".provider-card.selected");
    if (selectedCard) {
        provider = selectedCard.getAttribute("data-provider");
    } else if (llmConfig.provider) {
        provider = llmConfig.provider;
    }

    var apiKey = document.getElementById("modalApiKey").value.trim();
    var model = document.getElementById("modalModelSelect").value;
    var temperature = parseFloat(document.getElementById("modalTemperature").value) || 0.3;
    var maxTokens = parseInt(document.getElementById("modalMaxTokens").value) || 2048;
    var enabled = document.getElementById("modalEnabledToggle").checked;

    if (!provider) {
        showToast("请选择提供商", "error");
        return;
    }

    // 如果没输入新key，保留已有key
    if (!apiKey && llmConfig.api_key) {
        apiKey = llmConfig.api_key;
    }
    if (!apiKey) {
        showToast("请输入API Key", "error");
        return;
    }

    fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider: provider,
            api_key: apiKey,
            model: model,
            temperature: temperature,
            max_tokens: maxTokens,
            enabled: enabled
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showToast("配置已保存，AI功能已" + (enabled ? "启用" : "禁用"), "success");
                closeAIConfigModal();
                loadLLMConfig();
            }
        });
}

// ===== AI 问题分析 =====
function aiAnalyze() {
    var problem = document.getElementById("problemInput").value.trim();
    if (!problem) {
        showToast("请先输入问题描述", "error");
        return;
    }

    if (!isAIReady()) {
        showToast("请先配置大模型API Key", "error");
        openAIConfigModal();
        return;
    }

    var btn = document.getElementById("aiAnalyzeBtn");
    btn.disabled = true;
    btn.textContent = "🤖 分析中...";

    // 收集已匹配的条款
    var matchedClauses = [];
    if (lastMatchResults) {
        if (lastMatchResults.matches) matchedClauses = lastMatchResults.matches;
        else if (lastMatchResults.keyword_matches) matchedClauses = lastMatchResults.keyword_matches;
    }

    fetch("/api/llm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            problem: problem,
            matched_clauses: matchedClauses.slice(0, 3)
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                showAIAnalysisModal(data.analysis);
            }
            btn.disabled = false;
            btn.textContent = "🤖 AI分析";
        })
        .catch(function () {
            showToast("分析请求失败", "error");
            btn.disabled = false;
            btn.textContent = "🤖 AI分析";
        });
}

function showAIAnalysisModal(analysis) {
    var modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "flex";
    modal.innerHTML =
        '<div class="modal-content modal-lg">' +
            '<div class="modal-header">' +
                '<h3>🤖 AI问题分析报告</h3>' +
                '<button class="modal-close" onclick="this.closest(\'.modal\').remove()">&times;</button>' +
            '</div>' +
            '<div class="modal-body">' +
                '<div class="ai-analysis-full">' + escapeHtml(analysis) + '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
        if (e.target === modal) modal.remove();
    });
}

// ===== AI 通知书润色 =====
function aiPolishNotice() {
    if (!noticeTextCache) {
        showToast("请先生成通知书", "error");
        return;
    }

    if (!isAIReady()) {
        showToast("请先配置大模型API Key", "error");
        openAIConfigModal();
        return;
    }

    var btn = document.getElementById("polishBtn");
    btn.disabled = true;
    btn.textContent = "润色中...";

    var projectInfo = {
        project_name: document.getElementById("projectName").value.trim()
    };

    fetch("/api/llm/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            notice_text: noticeTextCache,
            project_info: projectInfo
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, "error");
            } else {
                noticeTextCache = data.polished;
                var preview = document.getElementById("noticePreview");
                preview.innerHTML = '<div class="notice-preview"><div class="notice-content">' +
                    escapeHtml(data.polished) + '</div></div>';
                showToast("AI润色完成", "success");
            }
            btn.disabled = false;
            btn.textContent = "🤖 AI润色";
        })
        .catch(function () {
            showToast("润色请求失败", "error");
            btn.disabled = false;
            btn.textContent = "🤖 AI润色";
        });
}

function showToast(msg, type) {
    var container = document.getElementById("toastContainer");
    var toast = document.createElement("div");
    toast.className = "toast " + (type || "info");
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(function () {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        setTimeout(function () {
            container.removeChild(toast);
        }, 300);
    }, 3000);
}

function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// 点击弹窗外关闭
document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal")) {
        e.target.style.display = "none";
    }
});
