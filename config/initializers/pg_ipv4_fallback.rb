begin
  require "resolv"
  require "uri"

  database_url = ENV["DATABASE_URL"].to_s

  if !database_url.empty? && database_url.start_with?("postgres://", "postgresql://") && ENV["PGHOSTADDR"].to_s.empty?
    uri = URI.parse(database_url)
    host = uri.host.to_s

    if !host.empty? && host !~ /\A\d{1,3}(?:\.\d{1,3}){3}\z/ && host !~ /\A\[[0-9a-fA-F:]+\]\z/
      addresses = Resolv.getaddresses(host)
      ipv4 = addresses.find { |addr| addr.include?(".") }
      ENV["PGHOSTADDR"] = ipv4 if ipv4
    end
  end
rescue StandardError
  # 意図的に握りつぶす: ここで失敗してもRails起動を止めない
end
