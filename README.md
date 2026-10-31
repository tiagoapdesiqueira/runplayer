# RunPlayer

Reprodutor de MP3 minimalista para iPhone, pensado para corrida. Tema escuro, botões grandes, áudio em segundo plano e controles na tela de bloqueio e nos fones.

Compilado 100% grátis sem Mac, instalado no iPhone via AltStore com Apple ID gratuito.

- **Bundle ID**: `com.tiago.runplayer`
- **Nome**: RunPlayer
- **Renovação**: a cada 7 dias (AltStore)

---

## O que o app faz

- Lista todos os `.mp3` da pasta do app (visível em **Arquivos › No meu iPhone › RunPlayer**).
- Toca, pausa, próxima, anterior e embaralha.
- Mostra nome da faixa e barra de progresso.
- Continua tocando com a tela bloqueada; aparece nos controles do lock screen e dos fones.
- Botão para recarregar a lista depois de copiar MP3s novos.

---

## 1. Subir o código para o GitHub (a partir do Windows)

Pré-requisitos no PC:
- [Git para Windows](https://git-scm.com/download/win)
- Conta no GitHub

Passos:

1. Em **github.com**, clique em **New repository**.
2. Nome qualquer (ex.: `runplayer`). **Marque como `Public`** (necessário para o GitHub Actions com macOS ser grátis e ilimitado).
3. **Não** marque "Add README". Clique em **Create repository**.
4. Abra o PowerShell em `d:\Projetos\Música` e rode:

```powershell
git init
git add .
git commit -m "RunPlayer v1"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/runplayer.git
git push -u origin main
```

O workflow começa a rodar automaticamente após o push. Acompanhe em **Actions** no GitHub.

---

## 2. Baixar o `.ipa` gerado

1. No GitHub, vá na aba **Actions**.
2. Clique na execução mais recente de **Build iOS (unsigned IPA)**.
3. No final da página, baixe o artifact **`ipa-unsigned`** (um `.zip`).
4. Extraia — dentro tem `RunPlayer-unsigned.ipa`. Guarde esse arquivo.

> Se der falha, baixe também o artifact **`xcodebuild-log`** e me mande — é por ali que a gente depura.

Para gerar um build novo manualmente: em **Actions › Build iOS › Run workflow**.

---

## 3. Instalar o AltServer no Windows

O AltServer é o programa de PC que assina e envia apps para o iPhone.

### 3.1 Instalar iTunes e iCloud (versões da Apple, NÃO da Microsoft Store)

A versão da Microsoft Store **não funciona** com AltServer. Baixe direto da Apple:

- **iTunes para Windows (64-bit)**: https://www.apple.com/itunes/download/win64
- **iCloud para Windows**: https://support.apple.com/en-us/HT204283 (link de "Windows" na página)

Instale os dois, abra uma vez cada, faça login com seu Apple ID.

> Se o Windows **não reconhecer o iPhone** após conectar o cabo, instale também o app **"Dispositivos Apple"** (Microsoft Store). Ele traz os drivers mais novos. Depois reinicie o PC.

### 3.2 Instalar o AltServer

1. Baixe em https://altstore.io (seção **AltServer for Windows**).
2. Instale e abra. Vai aparecer um ícone de losango na bandeja do sistema (ao lado do relógio).

---

## 4. Instalar o AltStore no iPhone

1. Conecte o iPhone no PC com cabo. Confie no computador.
2. **iTunes aberto**: certifique-se que o iPhone aparece lá e que o Wi-Fi Sync está marcado em **Sumário/Resumo › Sincronizar com este iPhone via Wi-Fi**.
3. Clique no ícone do AltServer na bandeja › **Install AltStore › [seu iPhone]**.
4. Vai pedir o Apple ID. Use seu Apple ID gratuito (recomendado criar um só para isso).
5. No iPhone: **Ajustes › Geral › VPN e Gerenciamento de Dispositivo** (ou "Gerenciamento de Perfis") › toque no seu Apple ID › **Confiar**.
6. Abra o AltStore no iPhone. Deve mostrar sua conta logada.

---

## 5. Instalar o `.ipa` do RunPlayer

1. Transfira o `RunPlayer-unsigned.ipa` para o iPhone de qualquer jeito (iCloud Drive, AirDrop via "Dispositivos Apple", e-mail, pendrive Lightning…). Mais fácil: salve no **iCloud Drive** pelo PC.
2. No iPhone, abra o app **Arquivos**, ache o `.ipa`, toque segurado › **Compartilhar › AltStore**.
3. AltStore pede o Apple ID (se for a primeira vez). Vai assinar e instalar. Demora ~1 minuto.
4. Pronto, RunPlayer aparece na tela inicial.

---

## 6. Renovar a cada 7 dias

Apple ID gratuito dá 7 dias de validade por app assinado. Para renovar sem ter que reinstalar tudo:

- Deixe o **PC ligado com AltServer rodando** (ícone na bandeja).
- iPhone e PC na **mesma rede Wi-Fi**.
- No AltStore do iPhone, aba **My Apps**: toque em **Refresh All**. Ou deixe o AltStore aberto em segundo plano — ele renova sozinho quando possível.

Dica: ative no iPhone **Ajustes › AltStore › Background App Refresh** para renovação automática.

Se passar dos 7 dias sem renovar, o app fica em cinza e não abre — basta reinstalar o `.ipa` ou dar refresh dentro do prazo seguinte.

---

## 7. Colocar MP3s no app

1. No iPhone, abra o app **Arquivos** (Files).
2. Vá na aba **Explorar/Procurar** › **No meu iPhone**.
3. Deve aparecer uma pasta chamada **RunPlayer**. Entre nela.
4. Copie seus `.mp3` para lá (pode arrastar de outra pasta, do iCloud Drive, do app "Fotos"/"Downloads" etc.).
5. Abra o RunPlayer e toque no botão **↻** (recarregar) no canto superior direito.

A pasta só aparece em "No meu iPhone" **depois** que o RunPlayer é aberto pela primeira vez.

### ⚠️ Aviso importante

**Desinstalar o app apaga a pasta e todos os MP3s dentro dela.** Sempre mantenha uma cópia dos MP3 no PC.

---

## 8. Rodando de novo o build (quando precisar)

Qualquer alteração que você fizer no código: `git add . && git commit -m "..." && git push` dispara um novo build. Baixa o `.ipa` novo, instala por cima pelo AltStore (ele faz upgrade).

Para forçar sem alterar código: **Actions › Build iOS › Run workflow › Run**.

---

## Estrutura do projeto

```
.
├── App.tsx                       # UI
├── index.ts                      # entry + registra playback service
├── service.ts                    # handlers de controles remotos (lock screen / fones)
├── app.json                      # config Expo (iOS: background audio, file sharing)
├── package.json
├── tsconfig.json
├── babel.config.js
└── .github/workflows/build-ios.yml
```

Pastas `ios/`, `android/` e `node_modules/` são geradas no CI e **não** devem ir pro Git (já estão no `.gitignore`).
