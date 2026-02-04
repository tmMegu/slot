begin
  require "uri"

  url = ENV["DATABASE_URL"].to_s.strip
  if !url.empty?
    uri = URI.parse(url)
    if uri.scheme&.start_with?("postgres")
      user = uri.user.to_s
      host = uri.host.to_s
      port = uri.port
      db = uri.path.to_s.sub(%r{^/}, "")

      logger = if defined?(Rails) && Rails.respond_to?(:logger) && Rails.logger
        Rails.logger
      else
        require "logger"
        Logger.new($stdout)
      end

      logger.info("DB target: host=#{host} port=#{port} db=#{db} user=#{user}")

      # Supabase Poolerは user に project_ref が必要: postgres.<project_ref> や myuser.<project_ref>
      if host.end_with?(".pooler.supabase.com") && !user.include?(".")
        logger.warn("DATABASE_URL user looks wrong for Supabase pooler. Expected 'role.<project_ref>' but got '#{user}'.")
      end
    end
  end
rescue StandardError
  # 起動を止めない
end
