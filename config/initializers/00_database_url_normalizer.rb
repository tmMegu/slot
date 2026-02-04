begin
  raw = ENV["DATABASE_URL"]
  if raw
    normalized = raw.strip

    # Renderの環境変数UIに "DATABASE_URL=..." 形式を貼ってしまった場合の救済
    normalized = normalized.sub(/\ADATABASE_URL\s*=\s*/i, "")

    # 先頭/末尾の引用符を除去
    if (normalized.start_with?("\"") && normalized.end_with?("\"")) ||
       (normalized.start_with?("'") && normalized.end_with?("'"))
      normalized = normalized[1..-2]
    end

    normalized = normalized.strip

    # よくある誤り: スキームが壊れて adapter が未知扱いになるのを回避
    normalized = normalized.sub(/\Apostgres\.postgres:\/\//i, "postgresql://")
    normalized = normalized.sub(/\Apostgres:\/\//i, "postgresql://")

    ENV["DATABASE_URL"] = normalized if normalized != raw
  end
rescue StandardError
  # ここで落ちても起動を止めない
end
