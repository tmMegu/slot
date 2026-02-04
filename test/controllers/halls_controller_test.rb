require "test_helper"

class HallsControllerTest < ActionDispatch::IntegrationTest
  test "should get index" do
    get halls_index_url
    assert_response :success
  end
end
