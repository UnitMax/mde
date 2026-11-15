import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { CopyButton } from '@/components/inbox/chat-ui'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { MermaidCodeBlock } from '@/lib/mermaid-code-block'
import { useToasts } from '@/store/toasts'

function ChatCodeBlockView({ node }: NodeViewProps): JSX.Element {
  return (
    <NodeViewWrapper>
      <pre>
        <NodeViewContent<'code'>
          as="code"
          className={node.attrs.language ? `language-${node.attrs.language}` : undefined}
          style={{ whiteSpace: 'pre' }}
        />
      </pre>
      <div contentEditable={false} className="chat-code-copy">
        <CopyButton
          text={node.textContent}
          label="Copy code"
          className="h-7 w-7 border border-line bg-panel shadow-sm"
          onError={(error) => useToasts.getState().show({
            key: 'chat-code-copy-error',
            tone: 'danger',
            icon: 'error',
            label: 'Not copied',
            title: ipcErrorMessage(error, 'Could not copy the code block.'),
          })}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** Inbox code blocks have a copy control; Mermaid keeps its diagram view. */
export const ChatCodeBlock = MermaidCodeBlock.extend({
  addNodeView() {
    const diagram = this.parent!()!
    const code = ReactNodeViewRenderer(ChatCodeBlockView, {
      className: 'chat-code-block',
      contentDOMElementTag: 'span',
      update: ({ newNode, updateProps }) => {
        if (newNode.attrs.language === 'mermaid') return false
        updateProps()
        return true
      },
    })
    return (props) => props.node.attrs.language === 'mermaid' ? diagram(props) : code(props)
  },
})
