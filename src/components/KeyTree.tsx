// Key 命名空间树：按「分隔符」（默认 :，可配置）把已加载的 key 分组为可折叠文件夹（参考其它 redis GUI）。
// 基于「当前已加载 keys[]」构建——加载更多会逐渐补全树（SCAN 分页语义）。
import { useMemo, useState, type MouseEvent } from "react";
import type { KeyBrief } from "../types";

interface TreeNode {
  /** 本节点段名 */
  name: string;
  /** 从根到本节点的完整路径（= 文件夹前缀，叶子时即完整 key） */
  path: string;
  /** 若本路径本身也是一个 key，则为叶子 */
  key?: KeyBrief;
  /** 子节点：段名 → 节点 */
  children: Map<string, TreeNode>;
  /** 子树内 key 总数（含自身若为 key） */
  count: number;
}

function buildTree(keys: KeyBrief[], sep: string): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), count: 0 };
  for (const kb of keys) {
    // 空分隔符：整个 key 当作单段（避免 split("") 逐字符炸开）。
    const segs = sep === "" ? [kb.key] : kb.key.split(sep);
    let node = root;
    let path = "";
    for (let i = 0; i < segs.length; i++) {
      // 路径拼接仅在非空分隔符时插入 sep。
      path = i === 0 || sep === "" ? segs[i] : `${path}${sep}${segs[i]}`;
      let child = node.children.get(segs[i]);
      if (!child) {
        child = { name: segs[i], path, children: new Map(), count: 0 };
        node.children.set(segs[i], child);
      }
      child.count += 1;
      if (i === segs.length - 1) child.key = kb;
      node = child;
    }
  }
  return root;
}

export interface TreeNodeLike {
  path: string;
  isFolder: boolean;
}

interface Props {
  keys: KeyBrief[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 命名空间分隔符（默认 ":"；"" = 不分组，每个 key 为单段）。 */
  separator: string;
  /** 右键节点（叶子或文件夹）。 */
  onContextMenu?: (e: MouseEvent, node: TreeNodeLike) => void;
}

export function KeyTreeView({ keys, selectedKey, onSelect, separator, onContextMenu }: Props) {
  // 分隔符变化也需重建树，故 separator 必须在依赖里。
  const root = useMemo(() => buildTree(keys, separator), [keys, separator]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="py-1 text-sm">
      <Level
        nodes={root.children}
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

function Level({
  nodes,
  depth,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
  onContextMenu,
}: {
  nodes: Map<string, TreeNode>;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onContextMenu?: (e: MouseEvent, node: TreeNodeLike) => void;
}) {
  const arr = [...nodes.values()].sort((a, b) => {
    // 文件夹在前，叶子在后；各自按名排序
    const af = a.children.size > 0 ? 0 : 1;
    const bf = b.children.size > 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      {arr.map((node) => {
        const hasChildren = node.children.size > 0;
        const isExpanded = expanded.has(node.path);
        const isKey = !!node.key;
        const selected = selectedKey === node.path;
        const onNameClick = () => {
          if (isKey) onSelect(node.path);
          else if (hasChildren) onToggle(node.path);
        };
        return (
          <div key={node.path}>
            <div
              className={`flex cursor-default items-center gap-1 py-1 pr-2 hover:bg-neutral-800/40 ${
                selected ? "bg-red-600/15" : ""
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu?.(e, { path: node.path, isFolder: hasChildren });
              }}
            >
              {hasChildren ? (
                <button
                  onClick={() => onToggle(node.path)}
                  className="w-4 shrink-0 text-neutral-500 hover:text-neutral-200"
                  aria-label="展开"
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-4 shrink-0 text-neutral-500">·</span>
              )}
              <span
                className={`min-w-0 flex-1 cursor-pointer truncate ${
                  selected ? "text-red-400" : isKey ? "text-neutral-100" : "text-neutral-300"
                }`}
                onClick={onNameClick}
                title={node.path}
              >
                {node.name}
                {hasChildren && (
                  <span className="ml-1 text-xs text-neutral-600">({node.count})</span>
                )}
              </span>
              {isKey && (
                <span className="shrink-0 text-xs text-sky-400">{node.key!.type}</span>
              )}
            </div>
            {hasChildren && isExpanded && (
              <Level
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
