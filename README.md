# Silhueta

**Remova fundos com precisão de fio de cabelo.** Removedor de fundo e conversor de imagens que roda 100% no navegador: nenhuma imagem é enviada para servidor nenhum. Para precisão máxima, quem quiser pode rodar o **[Silhueta Servidor](https://github.com/pedaeadr-hash/silhueta-servidor)** (C#, repositório separado), que roda um modelo maior no próprio computador.

Site estático, sem build e sem dependências de runtime no repositório. Pronto para a Vercel.

- **Remover fundo** (página principal): IA no navegador, refino de cabelo e bordas, pincéis de retoque, fundo/sombra/contorno, lote com ZIP.
- **Converter**: PNG, JPG, WebP, AVIF, GIF, BMP, ICO, PDF e SVG (vetorizado ou com foto embutida), com redimensionamento e ZIP.
- **Alta precisão (opcional)**: com o [Silhueta Servidor](https://github.com/pedaeadr-hash/silhueta-servidor) aberto no computador do usuário, o recorte usa o BiRefNet completo em 1024 px. Veja [Alta precisão](#alta-precisão-com-o-silhueta-servidor-opcional).
- **Protótipos de cor** (`/prototipos`): o mesmo layout em outras cores. O padrão é preto, branco e cinza, com vidro fosco.

---

## Recursos

### Remoção de fundo
| | |
|---|---|
| **Modelos de IA** | *Pessoas e cabelo* (MODNet) e *Objetos e produtos* (BiRefNet lite). No modo **Auto**, usa Objetos se o navegador tiver WebGPU e Pessoas caso contrário. |
| **Cor sólida** | Remove um fundo liso ou tela verde pela cor (sem IA, sem download). Tolerância, suavidade e opção de remover só o fundo conectado. |
| **Cabelo e bordas** | *Detalhe fino* e *alcance* (recuperam fios e semitransparências a partir da foto original), posição e nitidez da borda, contrair/expandir em px, suavizar e **remoção de halo de cor**. |
| **Limpeza** | Manchas isoladas, poeira longe do objeto, **regiões com a cor do fundo** (riscos claros e sombras que a IA marcou como objeto), manter só o maior objeto, preencher buracos. |
| **Retoque** | Pincéis **Restaurar**, **Apagar** e **Cabelo** (refina só onde você pintar), **varinha** por cor (Alt mantém), desfazer/refazer ilimitado. |
| **Fundo e efeitos** | Transparente, cor, degradê, foto, fundo original desfocado; sombra projetada; contorno estilo adesivo. |
| **Moldura** | Aparar espaço vazio, margem e proporção (1:1, 4:5, 16:9, 9:16). A moldura aparece tracejada na imagem. |
| **Exportar** | PNG, WebP ou JPG, qualidade, tamanho (original, 2048, 1080, 512), copiar para a área de transferência e **lote em ZIP** (com "aplicar a todas"). |
| **Visualização** | Zoom e arrastar, antes/depois (segurar `C`) e divisor, fundo xadrez/escuro/claro. |

### Converter
PNG ⇄ JPG ⇄ WebP ⇄ AVIF ⇄ GIF ⇄ BMP ⇄ ICO ⇄ PDF ⇄ SVG, várias imagens de uma vez, escolha de cor de fundo para formatos sem transparência, vários tamanhos no `.ico`, e botões **Data URI** e **PowerApps** (texto entre aspas pronto para a propriedade `Image`).

---

## Como funciona o recorte

```
foto ─▶ IA (máscara bruta) ─▶ detalhe fino ─▶ forma da borda ─▶ limpeza ─▶ cores sem halo ─▶ pincéis ─▶ imagem final
```

1. A IA devolve uma máscara suave, mas em baixa resolução e sem os fios mais finos.
2. **Detalhe fino** refina essa máscara com a própria foto: um *guided filter* cola a borda nos contornos reais e, numa faixa em volta do objeto, o alfa de cada pixel é estimado pela mistura entre a cor local do objeto e a cor local do fundo. Onde o fundo é liso, isso recupera fios que a IA perdeu; onde o fundo é complexo, a confiança cai e o refino recua.
3. **Halo de cor** é removido estimando a cor real do objeto em cada pixel de borda (fusão de desfoques, Forte & Pitié, 2021).
4. Os pincéis ficam guardados como traços normalizados e são refeitos em qualquer resolução: o que você vê na prévia é o que sai na exportação em tamanho real.

O cálculo pesado roda num Worker, então os sliders não travam a página. A IA roda em um worker próprio do ONNX Runtime.

---

## Rodar localmente

Precisa de **Node 18+** só para o servidor de desenvolvimento (o projeto em si não tem dependências).

- **Windows:** dê dois cliques em `iniciar.bat`. Ele sobe o servidor e abre o navegador em http://localhost:5173. Mantenha a janela aberta enquanto usa.
- **macOS e Linux:** `sh iniciar.sh`.
- **Qualquer sistema:**
  ```bash
  npm run dev
  # abre em http://localhost:5173
  ```

O script `scripts/dev-server.mjs` envia os mesmos cabeçalhos do `vercel.json` (inclusive o isolamento de origem que libera múltiplas threads no WebAssembly).

Alternativas: `npx serve .`, `python -m http.server`, ou a extensão *Live Server* do VS Code. O site precisa ser servido por `http://` ou `https://`. Abrir o `index.html` direto do disco (`file://`) não funciona, porque o navegador bloqueia módulos ES e workers; nesse caso a página mostra um aviso explicando o que fazer, mas os botões ficam inativos.

Parâmetros úteis na URL:

| Parâmetro | Efeito |
|---|---|
| `?demo=1` | Abre o estúdio com uma imagem sintética (modo Cor), sem baixar modelo. |
| `?tema=lima` | Aplica um tema só naquela visita (grafite, claro, lima, aurora, brasa, oceano, duna). |
| `?proxy=0` | Roda a IA na thread principal (diagnóstico). |

---

## Alta precisão com o Silhueta Servidor (opcional)

Para recortes no nível dos sites profissionais existe o **Silhueta Servidor**, num repositório separado: [`silhueta-servidor`](https://github.com/pedaeadr-hash/silhueta-servidor). É um programa em C# que roda o **BiRefNet completo em 1024 px** (MIT) no computador de quem está usando o site.

**Cada visitante usa o próprio computador.** O site chama `http://localhost:5174`, e "localhost" é sempre a máquina de quem está com o site aberto. Ninguém depende do seu PC estar ligado:

| Quem abre o site | O que acontece |
|---|---|
| Não tem o servidor (a maioria) | Usa os modelos do navegador, como sempre. Nada muda. |
| Tem o servidor aberto | Liga **Alta precisão** no painel *Recorte* e o recorte roda no computador dele. A foto não sai da máquina dele. |

**Para o usuário:** baixar o zip na página de [Releases](https://github.com/pedaeadr-hash/silhueta-servidor/releases/latest), dar dois cliques em `Silhueta-Servidor.exe` (não precisa instalar nada) e deixar a janela aberta. O próprio site mostra esse link quando não encontra o servidor.

O endereço do download está em `SERVER_DOWNLOAD`, no arquivo `assets/js/engine.js`. Troque se o repositório do servidor tiver outro nome ou dono. O servidor já aceita chamadas de `https://silhueta*.vercel.app`; se o site ficar num domínio próprio, adicione-o em `AllowedOrigins` no `appsettings.json` do servidor.

O Chrome e o Edge podem pedir permissão para o site **acessar a rede local**: é preciso permitir. O Safari bloqueia chamadas de sites `https` para `http://localhost`, então lá a alta precisão não funciona, e o site segue com os modelos do navegador.

---

## Publicar na Vercel

1. **Suba para o GitHub**
   ```bash
   cd silhueta
   git init
   git add .
   git commit -m "Silhueta: removedor de fundo e conversor"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/silhueta.git
   git push -u origin main
   ```
2. Na Vercel: **Add New… → Project**, importe o repositório.
3. Em *Framework Preset* deixe **Other**. **Não** há comando de build e o diretório de saída é a raiz (`.`).
4. **Deploy.** O `vercel.json` já ativa URLs limpas (`/converter`, `/prototipos`) e os cabeçalhos de segurança e de isolamento.

Pela linha de comando: `npx vercel` (prévia) e `npx vercel --prod`.

> **Cabeçalhos COOP/COEP.** Eles liberam threads no WebAssembly (a IA sem WebGPU fica bem mais rápida). Como consequência, qualquer recurso externo que você adicionar à página precisa permitir carregamento cross-origin (CORS ou `Cross-Origin-Resource-Policy`). Google Fonts, jsDelivr e Hugging Face já permitem. Se preferir não usar isolamento, remova os dois cabeçalhos do `vercel.json`; tudo continua funcionando, só mais devagar sem WebGPU.

---

## Modelos de IA e licenças

Os modelos são baixados do Hugging Face **na primeira vez** que são usados e ficam no cache do navegador. Depois disso a página abre sem rede. A biblioteca (`transformers.js`, Apache-2.0) vem do jsDelivr, fixada na versão `3.8.1`.

| Modo | Modelo | Licença | Tamanho | Observação |
|---|---|---|---|---|
| Pessoas | [`Xenova/modnet`](https://huggingface.co/Xenova/modnet) (MODNet) | Apache-2.0 | ~26 MB | Matting de retrato, ótimo em cabelo. Roda em WASM. |
| Objetos | [`studioludens/birefnet-lite-512`](https://huggingface.co/studioludens/birefnet-lite-512) (BiRefNet lite) | MIT | ~94 MB (WebGPU, fp16) ou ~183 MB (WASM, fp32) | Entrada de 512 px; o detalhe é recuperado pelo refino. |

Escolhi só modelos com licença que permite uso comercial. **Não** incluí o RMBG-1.4/2.0 (Bria) porque a licença é não comercial. As variantes de 1024 px do BiRefNet estouram a memória do `onnxruntime-web`, por isso a de 512.

Para trocar ou adicionar um modelo, edite `assets/js/engine.js` (`MODELS`, `LIB_URL`). Para hospedar os modelos você mesmo, aponte `env.remoteHost` do transformers.js para o seu domínio.

---

## Estrutura

```
silhueta/
├── index.html              Remover fundo (página principal)
├── converter.html          Converter formatos
├── prototipos/             Galeria de protótipos de cor (o app real em cada tema)
├── assets/
│   ├── css/
│   │   ├── tokens.css      Temas (variáveis de cor). Edite aqui para mudar as cores
│   │   ├── base.css        Vidro fosco, botões, controles, cabeçalho
│   │   ├── studio.css      Landing e estúdio
│   │   └── converter.css   Conversor
│   └── js/
│       ├── app.js          Estúdio: itens, lote, IA, pincéis, exportação
│       ├── engine.js       Modelos de IA (transformers.js)
│       ├── worker.js       Pipeline do recorte fora da thread da página
│       ├── pipeline.js     Etapas e parâmetros do recorte (puro, sem DOM)
│       ├── refine.js       Refino de cabelo, bordas, halo, limpeza (puro, sem DOM)
│       ├── edits.js        Traços dos pincéis, refeitos em qualquer resolução
│       ├── compose.js      Fundo, sombra, contorno, moldura, codificação
│       ├── viewport.js     Zoom, arrastar, comparação, ferramentas
│       ├── convert.js      Conversor (+ convert-worker.js, vectorize.js)
│       ├── encoders.js     BMP, GIF, ICO e PDF escritos à mão
│       ├── zip.js          ZIP sem compressão
│       └── theme.js        Tema (carregado no <head>)
├── iniciar.bat / iniciar.sh  Abrem o site num servidor local (dois cliques no Windows)
├── scripts/
│   ├── dev-server.mjs      Servidor local sem dependências
│   └── gen-static.mjs      Gera cabeçalho, ícone e arte do comparador dentro dos HTML (npm run gen)
├── tests/                  Testes numéricos (Node)
├── vercel.json             Cabeçalhos e URLs limpas
└── .vercelignore           Deixa tests/ e scripts/ fora do deploy
```

---

## Personalizar

- **Nome.** Procure por `Silhueta` em `index.html`, `converter.html`, `prototipos/index.html`, `scripts/gen-static.mjs` (cabeçalho), `assets/js/ui.js`, `iniciar.bat` e `package.json`. Depois rode `npm run gen` para atualizar o cabeçalho dentro dos HTML.
- **Partes geradas.** O sprite de ícones, o cabeçalho, o ícone do app e a arte do comparador ficam dentro dos HTML entre marcadores `<!-- gen:... -->`, para a página aparecer completa antes do JavaScript carregar. Não edite entre os marcadores; mude `scripts/gen-static.mjs` e rode `npm run gen`.
- **Cores.** Tudo sai de variáveis em `assets/css/tokens.css`. O tema padrão é o `grafite`; para mudar, troque `data-theme` no `<html>` de `index.html` e `converter.html`. Para criar um tema novo, copie um bloco `:root[data-theme="..."]`, ajuste as variáveis e adicione o nome em `assets/js/theme.js`.
- **Valores padrão dos ajustes.** `MATTE_DEFAULTS` em `assets/js/pipeline.js` e `LOOK_DEFAULTS` em `assets/js/compose.js`.

---

## Testes

```bash
npm test    # roda os três conjuntos abaixo

node tests/refine.test.mjs     # refinamento: cabelo sintético, halo de cor, contrair/expandir, limpeza
node tests/encoders.test.mjs   # BMP, GIF (com decodificador LZW próprio), ICO e PDF lidos de volta
node tests/engine.test.mjs     # acabamento da máscara da IA (máscara fraca, chapada ou vazia)
```

O teste de refino gera cabelo sintético com o alfa verdadeiro conhecido e mede o erro antes e depois: com fundo liso o erro da borda cai cerca de 40%; com fundo da cor do cabelo o refino não piora o resultado.

---

## Atalhos

`V` mover · `B` restaurar · `E` apagar · `H` cabelo · `W` varinha · `[` `]` tamanho do pincel · `Ctrl+Z` / `Ctrl+Shift+Z` desfazer e refazer · segurar `C` mostra o original · `S` divide antes/depois · `0` ajusta à tela · `Ctrl+S` baixa · `Ctrl+V` cola imagem · `?` ajuda.

---

## Limites conhecidos

- **Fundo com riscos ou texturas.** Às vezes a IA marca riscos claros do fundo como objeto. A limpeza descarta as regiões separadas que têm a cor do fundo; se sobrar algo, use *Manter só o maior objeto* ou a varinha.
- **Cabelo em fundo complexo.** O refino por cor funciona melhor com fundo liso ou desfocado. Em fundos movimentados ele recua; use o pincel **Cabelo** nas regiões que importam.
- **Tamanho.** Imagens maiores que 4096 px no lado maior são reduzidas ao abrir. Os ajustes rodam numa prévia de até 1400 px e a exportação refaz tudo em tamanho real.
- **WebGPU.** O modelo de Objetos é bem mais rápido com WebGPU. Sem ela, roda em WASM (alguns segundos a mais por imagem). Algumas placas de vídeo erram em silêncio e devolvem uma máscara fraca ou vazia: o app estica máscaras fracas, repete em WASM quando a GPU devolve lixo, tenta o outro modelo no modo Auto se nada for encontrado e tem o botão **Usar só o processador** (ou `?gpu=0` na URL). A linha do modelo mostra onde rodou e quanto da imagem a IA marcou como objeto.
- **Formatos.** AVIF depende de o navegador conseguir gerar; HEIC não é lido pela maioria dos navegadores. GIF tem 256 cores e transparência de 1 bit.
- **Navegadores.** Desenvolvido e testado no Edge (Chromium). Chrome deve se comportar igual; Firefox e Safari não foram testados.
- **Fotos com transparência.** São achatadas sobre branco antes da detecção.

---

## Licenças de terceiros

- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) e ONNX Runtime Web (MIT), carregados do jsDelivr.
- MODNet (Apache-2.0) e BiRefNet (MIT), conforme a tabela acima.
- Fonte [Inter](https://rsms.me/inter/) (SIL OFL) via Google Fonts, com a pilha de fontes do sistema como alternativa.
- Defina a licença do **seu** repositório antes de publicar.
