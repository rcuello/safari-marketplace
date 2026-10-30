import Quill, { QuillOptionsStatic } from 'quill';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

// react-quill 2.0.0 busca su área de edición con ReactDOM.findDOMNode, que
// React 19 retiró, y no tiene versión nueva. Su fork react-quill-new monta
// Quill 2, con el que no funcionan los dos plugins del editor (emoji y
// color-picker son de Quill 1). Este envoltorio monta Quill 1 sobre un ref y
// replica lo que el admin usaba de react-quill (US-83): el DOM
// `div.quill > toolbar + área`, el valor HTML controlado, `onChange(html)`,
// `onBlur`, `readOnly` y la instancia de Quill por `ref`. Como en react-quill,
// `modules`, `formats` y `theme` se leen una sola vez, al montar.
export type QuillEditorProps = {
  id?: string;
  className?: string;
  value?: string;
  onChange?: (html: string) => void;
  onBlur?: () => void;
  modules?: QuillOptionsStatic['modules'];
  formats?: string[];
  theme?: string;
  placeholder?: string;
  readOnly?: boolean;
};

const QuillEditor = forwardRef<Quill | null, QuillEditorProps>(
  function QuillEditor(
    {
      id,
      className,
      value,
      onChange,
      onBlur,
      modules,
      formats,
      theme,
      placeholder,
      readOnly,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Quill | null>(null);
    // Último HTML conocido, para no reescribir el editor con su propio valor.
    const valueRef = useRef(value ?? '');
    const callbacksRef = useRef({ onChange, onBlur });

    useEffect(() => {
      callbacksRef.current = { onChange, onBlur };
    });

    // Va antes que useImperativeHandle: así el ref ya recibe la instancia.
    useLayoutEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const area = container.appendChild(document.createElement('div'));
      const editor = new Quill(area, {
        modules,
        formats,
        theme,
        placeholder,
        readOnly,
      });
      const handleTextChange = () => {
        const html = editor.root.innerHTML;
        if (html === valueRef.current) return;
        valueRef.current = html;
        callbacksRef.current.onChange?.(html);
      };
      const handleSelectionChange = (range: unknown, oldRange: unknown) => {
        if (oldRange && !range) callbacksRef.current.onBlur?.();
      };
      editor.on('text-change', handleTextChange);
      editor.on('selection-change', handleSelectionChange);
      editor.setContents(editor.clipboard.convert(valueRef.current));
      editorRef.current = editor;
      return () => {
        editor.off('text-change', handleTextChange);
        editor.off('selection-change', handleSelectionChange);
        editorRef.current = null;
        container.innerHTML = '';
      };
    }, []);

    useImperativeHandle<Quill | null, Quill | null>(
      ref,
      () => editorRef.current,
      [],
    );

    useEffect(() => {
      const editor = editorRef.current;
      const next = value ?? '';
      if (!editor || next === valueRef.current) return;
      valueRef.current = next;
      editor.setContents(editor.clipboard.convert(next));
    }, [value]);

    useEffect(() => {
      editorRef.current?.enable(!readOnly);
    }, [readOnly]);

    return (
      <div id={id} ref={containerRef} className={`quill ${className ?? ''}`} />
    );
  },
);

export default QuillEditor;
