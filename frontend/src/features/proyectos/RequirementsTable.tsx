import { Table } from "react-bootstrap";
export function RequirementsTable({ requirements, children }: { requirements: any[]; children?: React.ReactNode }) { return <Table responsive className="mb-0"><tbody>{children || requirements.map((item) => <tr key={item.id}><td>{item.codigo}</td><td>{item.titulo}</td></tr>)}</tbody></Table>; }
