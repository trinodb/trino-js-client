((typescript-mode
  . (
     (eval . (let ((project-directory (car (dir-locals-find-file default-directory))))
               (setq lsp-eslint-node-path (concat project-directory ".yarn/sdks"))
               (setq lsp-clients-typescript-server-args `("--tsserver-path" ,(concat project-directory ".yarn/sdks/typescript/bin/tsserver") "--stdio")))))))
