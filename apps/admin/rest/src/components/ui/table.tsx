import 'rc-table/assets/index.css';
import RcTable from 'rc-table';
import type { TableProps } from 'rc-table/lib/Table';
import type { DefaultRecordType } from 'rc-table/lib/interface';
export type AlignType = 'left' | 'center' | 'right';

// rc-table 7.22.2 declara sus valores por defecto con `Table.defaultProps`,
// que React 19 ignora en los componentes de función: sin ellos las clases
// salen como `undefined-*` y la tabla pierde sus estilos. Se aplican aquí los
// mismos valores (US-83). La 7.55 ya no usa defaultProps, pero memoiza el
// `render` de las celdas y rompe las columnas que llaman a hooks dentro.
export function Table<RecordType extends DefaultRecordType>({
  prefixCls = RcTable.defaultProps.prefixCls,
  rowKey = RcTable.defaultProps.rowKey,
  emptyText = RcTable.defaultProps.emptyText,
  ...props
}: TableProps<RecordType>) {
  return (
    <RcTable<RecordType>
      prefixCls={prefixCls}
      rowKey={rowKey}
      emptyText={emptyText}
      {...props}
    />
  );
}
