# プロジェクト保存先の設定

プロジェクト保存機能は、Vercel Blobの接続情報がある場合はクラウドへ、ない場合は開発PC内の `.project-data` へ保存します。画面とAPIは共通なので、保存先を切り替えても操作方法は変わりません。

## Vercelでクラウド保存を有効にする

1. Vercelでこのプロジェクトを開き、`Storage` を選びます。
2. `Create Database` から `Blob` を選び、Privateの保存領域を作ります。
3. プロジェクトへ接続すると、Vercel上では認証情報が自動設定されます。
4. ローカルPCでもクラウド保存を試す場合は、Vercel CLIで環境変数を取得するか、`.env.local` に `BLOB_READ_WRITE_TOKEN` を設定してアプリを再起動します。

APIキーやBlobトークンは画面、README、GitHubへ貼り付けないでください。会社別管理を追加するときは、現在の `companyId` をログイン中の会社IDへ置き換えることで、会社ごとに保存場所を分離できます。
