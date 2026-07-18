import type { ApiFieldDefinition } from "../data/model";

export function ApiFieldTable({ fields }: { fields: readonly ApiFieldDefinition[] }) {
  return (
    <div className="table-wrap">
      <table className="field-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>类型</th>
            <th>提供方</th>
            <th>含义与稳定性</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((item) => (
            <tr key={item.name}>
              <td>
                <code>{item.name}</code>
                {item.required ? <span className="required-mark">必填</span> : null}
              </td>
              <td><code>{item.type}</code></td>
              <td>{item.owner}</td>
              <td>
                <span>{item.description}</span>
                {item.defaultValue ? <small>默认：{item.defaultValue}</small> : null}
                {item.stability ? <small>稳定性：{item.stability}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
