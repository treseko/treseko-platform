import { Table } from "react-bootstrap";
export function StoriesTable({ stories, children }: { stories: any[]; children?: React.ReactNode }) { return <Table responsive className="mb-0"><tbody>{children || stories.map((item) => <tr key={item.id}><td>{item.codigo}</td><td>{item.titulo}</td></tr>)}</tbody></Table>; }
